"""M1-A audit item #5 — STATIC tenant-filter checker (CI gate).

Companion to the runtime audit in `backend/app/tenant_query_audit.py`. The
runtime listener catches missing `tenant_id` filters at query time; this script
catches them at PR-review time so the bug never reaches the engine.

What it does
------------
For every `.py` file under ``backend/app/routers/`` and ``backend/app/services/``:

1. Find every SQLAlchemy query starter — `select(...)`, `update(...)`,
   `delete(...)`, `insert(...)`, or `<session>.query(...)`.
2. Identify the target model (the first positional arg). If that model carries
   a `tenant_id` column (discovered from the model files), the query is
   "guarded".
3. For a guarded query, search the enclosing function body for any reference to
   the token ``tenant_id``. If none is found, record a violation. We deliberately
   scope the search to the entire enclosing function — not just the immediate
   chained method-call expression — because real code routinely re-assigns the
   query across multiple statements (``q = select(X); q = q.where(...);
   q = q.where(X.tenant_id == ...)``). That breadth biases the checker toward
   false negatives (missed violations) over false positives (legitimate queries
   flagged) — the runtime audit catches the misses.

Bypass mechanisms
-----------------
* ``# tenant-filter-ok:`` on the same line as the query starter → skipped.
* Function name starts with ``seed_``, ``migrate_`` → skipped (one-shot setup
  code; tenant scoping is owned by the caller).
* Function declares a parameter named ``owner_session`` or ``_owner`` →
  skipped (owner-role legitimate bypass).

CI integration
--------------
Run from anywhere::

    python backend/scripts/check_tenant_filter.py

Exit 0 if violation count equals the recorded baseline (``.tenant_filter_baseline``
next to this script), exit 1 with a precise file:line:reason list otherwise.
The baseline file holds the legacy violations the team has agreed to address
incrementally — the gate only fails on NEW violations. To regenerate the
baseline (rare, only after a deliberate cleanup pass), run with
``--write-baseline``.

Constraints honored
-------------------
* Stdlib only (``ast``, ``pathlib``, ``sys``, ``re``).
* Fast — completes the whole repo in well under 10 seconds.
* Read-only (touches no model, no router, no migration, no test).
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

# ---- paths --------------------------------------------------------------------------------------

_THIS = Path(__file__).resolve()
_BACKEND = _THIS.parent.parent           # backend/
_REPO = _BACKEND.parent                  # repo root
_MODELS_DIR = _BACKEND / "app" / "models"
_SCAN_DIRS = (
    _BACKEND / "app" / "routers",
    _BACKEND / "app" / "services",
)
_BASELINE = _THIS.parent / ".tenant_filter_baseline"

# ---- query-starter recognition ------------------------------------------------------------------

# SQLAlchemy Core query starters. ORM-style `session.query(Model)` is detected
# separately (it's a method call, not a bare name).
_QUERY_STARTER_NAMES = frozenset({"select", "update", "delete", "insert"})

# Method names that indicate a starter consumed inside `s.execute(...)` /
# `session.execute(...)` — we still treat the inner `select(...)` as the
# starter, this just helps explain the AST shape.
_EXECUTE_METHOD_NAMES = frozenset({"execute", "scalar", "scalars"})


# ---- model discovery ----------------------------------------------------------------------------

def discover_tenant_scoped_models(models_dir: Path) -> frozenset[str]:
    """Walk every model file and collect class names that declare a `tenant_id`
    attribute. Mirrors `tenant_query_audit._discover_tenant_scoped_tables` but at
    the AST level — no SQLAlchemy import, no DB connection required.

    A class is considered tenant-scoped if its body contains either a
    `tenant_id: <type> = mapped_column(...)` (PEP-526 annotated assignment, the
    SQLAlchemy 2.0 idiom used throughout GAAhex) or a plain `tenant_id =
    Column(...)` assignment.
    """
    names: set[str] = set()
    for path in sorted(models_dir.glob("*.py")):
        if path.name == "__init__.py":
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            if _class_has_tenant_id(node):
                names.add(node.name)
    return frozenset(names)


def _class_has_tenant_id(cls: ast.ClassDef) -> bool:
    """True iff the class body declares a `tenant_id` column attribute."""
    for stmt in cls.body:
        # `tenant_id: Mapped[...] = mapped_column(...)` — annotated assign
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            if stmt.target.id == "tenant_id":
                return True
        # `tenant_id = Column(...)` — plain assign (legacy SQLAlchemy 1.x style)
        if isinstance(stmt, ast.Assign):
            for tgt in stmt.targets:
                if isinstance(tgt, ast.Name) and tgt.id == "tenant_id":
                    return True
    return False


# ---- scan a single file -------------------------------------------------------------------------

def _first_arg_model_name(call: ast.Call) -> str | None:
    """Extract the name of the model the query targets.

    Supports the patterns we see in this codebase:
        select(Order)                              → "Order"
        select(Order.id, Order.status)             → "Order"
        select(func.count()).select_from(Order)    → handled at the chain level
        session.query(Order)                       → "Order"
    Returns None when the first arg isn't a model-like reference (e.g.
    `select(func.count())` with no model — we can't tell from one call alone).
    """
    if not call.args:
        return None
    a = call.args[0]
    # `Order` → Name
    if isinstance(a, ast.Name):
        return a.id
    # `Order.id`, `Order.status.label(...)` → Attribute chain — descend to root
    if isinstance(a, ast.Attribute):
        cur: ast.expr = a
        while isinstance(cur, ast.Attribute):
            cur = cur.value
        if isinstance(cur, ast.Name):
            return cur.id
    # `func.count(Order.id)` → Call whose func is an Attribute on a non-model
    # → not a direct target; skip (the runtime audit will catch it via SQL).
    return None


def _is_query_starter(call: ast.Call) -> tuple[bool, str | None]:
    """Return (is_starter, kind) where kind is "select"/"update"/"delete"/
    "insert"/"query" for diagnostics. False means this call is something else.
    """
    f = call.func
    # Bare `select(...)` / `update(...)` / etc.
    if isinstance(f, ast.Name) and f.id in _QUERY_STARTER_NAMES:
        return True, f.id
    # `session.query(Model)` / `s.query(Model)`
    if isinstance(f, ast.Attribute) and f.attr == "query":
        return True, "query"
    return False, None


def _has_noqa(source_lines: list[str], lineno: int) -> bool:
    """True iff the line carrying the query starter has a `# tenant-filter-ok:`
    pragma. Cheap whole-line substring check — anchored exact match would be
    overly strict if devs add a justification after the pragma.
    """
    if not (1 <= lineno <= len(source_lines)):
        return False
    line = source_lines[lineno - 1]
    # Our OWN bypass marker — deliberately NOT a `# noqa:` directive: `tenant-filter` is not a Ruff
    # code, so `# noqa: tenant-filter` made Ruff warn "Invalid `# noqa` directive" on every use.
    return "tenant-filter-ok" in line


def _enclosing_func(path: list[ast.AST]) -> ast.FunctionDef | ast.AsyncFunctionDef | None:
    """Return the nearest enclosing function for the AST stack `path`."""
    for node in reversed(path):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return node
    return None


def _func_is_bypassed(func: ast.FunctionDef | ast.AsyncFunctionDef | None) -> bool:
    """Owner-role / seed / migration legitimate bypass — these functions either
    seed data outside any tenant context or run as the `gaahex` owner role
    (RLS-bypassing by design) so a missing `tenant_id` filter is intentional.
    """
    if func is None:
        return False
    name = func.name.lower()
    if name.startswith("seed_") or name.startswith("migrate_"):
        return True
    for arg in (*func.args.args, *func.args.kwonlyargs, *func.args.posonlyargs):
        if arg.arg in ("owner_session", "_owner"):
            return True
    return False


def _func_source_mentions_tenant_id(func: ast.FunctionDef | ast.AsyncFunctionDef, source_lines: list[str]) -> bool:
    """True iff `tenant_id` appears as a whole word anywhere in the function
    body. We use the textual source (cheaper than re-walking the AST) and a
    word-boundary regex so `something_tenant_idea` doesn't match.

    Scanning the full function rather than the single chained-call expression
    is intentional: real handlers routinely build the query across several
    statements (``q = select(X); ...; q = q.where(X.tenant_id == tid)``), and
    we'd rather skip a legitimate query than chase the dataflow.
    """
    start = func.lineno - 1
    end = getattr(func, "end_lineno", None)
    body = "\n".join(source_lines[start:end]) if end else "\n".join(source_lines[start:])
    return _TENANT_ID_TOKEN.search(body) is not None


_TENANT_ID_TOKEN = re.compile(r"\btenant_id\b")


def scan_file(path: Path, guarded: frozenset[str]) -> list[tuple[Path, int, str]]:
    """Return the list of violations for `path`. Each entry is
    (file, lineno, model-name). Empty list = clean file.
    """
    text = path.read_text(encoding="utf-8")
    source_lines = text.splitlines()
    try:
        tree = ast.parse(text, filename=str(path))
    except SyntaxError:
        # File doesn't parse — out of scope for this checker. Let pytest /
        # ruff catch it; we just skip.
        return []

    violations: list[tuple[Path, int, str]] = []

    # Pre-walk: build parent map so we can ask "what function encloses this
    # call?". ast doesn't track parents natively.
    parents: dict[ast.AST, list[ast.AST]] = {}
    stack: list[ast.AST] = []

    def visit(node: ast.AST) -> None:
        parents[node] = list(stack)
        stack.append(node)
        for child in ast.iter_child_nodes(node):
            visit(child)
        stack.pop()

    visit(tree)

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        is_starter, _kind = _is_query_starter(node)
        if not is_starter:
            continue
        model = _first_arg_model_name(node)
        if model is None or model not in guarded:
            continue
        # Bypass: per-line noqa pragma.
        if _has_noqa(source_lines, node.lineno):
            continue
        # Bypass: owner-role / seed / migration function.
        enclosing = _enclosing_func(parents.get(node, []))
        if _func_is_bypassed(enclosing):
            continue
        # The lenient check — any tenant_id token anywhere in the function.
        if enclosing is not None and _func_source_mentions_tenant_id(enclosing, source_lines):
            continue
        # No enclosing function (module-level statement) — fall back to
        # scanning the whole module for the token. Module-level queries are
        # rare in this codebase (mostly route registration, not data reads).
        if enclosing is None and _TENANT_ID_TOKEN.search(text) is not None:
            continue
        violations.append((path, node.lineno, model))

    return violations


# ---- baseline persistence -----------------------------------------------------------------------

def _format_violation(v: tuple[Path, int, str]) -> str:
    """Render one violation as a stable, baseline-friendly line: relative path
    + lineno + model. Path is relative to the repo root so a baseline survives
    being checked out in a different absolute location (CI vs. dev machines).
    """
    file, lineno, model = v
    try:
        rel = file.resolve().relative_to(_REPO).as_posix()
    except ValueError:
        rel = file.as_posix()
    return f"{rel}:{lineno}:missing tenant_id filter on guarded model {model}"


def _load_baseline() -> set[str]:
    """Read the baseline file. Blank file (or missing) → empty set."""
    if not _BASELINE.exists():
        return set()
    out: set[str] = set()
    for line in _BASELINE.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        out.add(s)
    return out


def _write_baseline(violations: list[str]) -> None:
    """Persist the current violation set as the new baseline. Header is a
    pointer to this file for future maintainers."""
    header = (
        "# Tenant-filter static-analysis baseline.\n"
        "# Each line below is a legacy violation the CI gate tolerates. New\n"
        "# violations cause the CI step to fail; fix them at the source or, if\n"
        "# legitimate, add `# tenant-filter-ok:` with justification.\n"
        "# Regenerate (rare) with: python backend/scripts/check_tenant_filter.py --write-baseline\n"
    )
    body = "\n".join(sorted(violations)) + ("\n" if violations else "")
    _BASELINE.write_text(header + body, encoding="utf-8")


# ---- driver -------------------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    write_baseline = "--write-baseline" in argv

    guarded = discover_tenant_scoped_models(_MODELS_DIR)
    if not guarded:
        print(
            "check_tenant_filter: no tenant-scoped models discovered — "
            "models dir empty or unparseable?",
            file=sys.stderr,
        )
        return 0  # nothing to check; don't fail CI on infra glitch

    all_violations: list[tuple[Path, int, str]] = []
    for scan_dir in _SCAN_DIRS:
        if not scan_dir.exists():
            continue
        for path in sorted(scan_dir.rglob("*.py")):
            # Skip __init__.py and any test/migration files that may live in
            # services subdirs (e.g. services/payments/__init__.py).
            if path.name == "__init__.py":
                continue
            all_violations.extend(scan_file(path, guarded))

    rendered = [_format_violation(v) for v in all_violations]

    if write_baseline:
        _write_baseline(rendered)
        print(
            f"check_tenant_filter: wrote baseline of {len(rendered)} violation(s) "
            f"to {_BASELINE.relative_to(_REPO).as_posix()}"
        )
        return 0

    baseline = _load_baseline()
    new = sorted(set(rendered) - baseline)
    fixed = sorted(baseline - set(rendered))

    if not new:
        msg = (
            f"check_tenant_filter: OK ({len(rendered)} violation(s), "
            f"all in baseline — {len(guarded)} guarded models)"
        )
        if fixed:
            msg += f"; {len(fixed)} baseline entries no longer present (consider trimming the baseline)"
        print(msg)
        return 0

    print("check_tenant_filter: NEW violations not in baseline:", file=sys.stderr)
    for line in new:
        print(f"  {line}", file=sys.stderr)
    print(
        f"\n{len(new)} new violation(s). Either:\n"
        "  1. Add a `tenant_id` filter to the query (the right fix), or\n"
        "  2. Add `# tenant-filter-ok:` on the query-starter line with a justification, or\n"
        "  3. (rare) Move the query into a `seed_*` / `migrate_*` function or pass `owner_session`.\n",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
