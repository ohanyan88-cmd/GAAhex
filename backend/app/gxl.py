"""GXL — the shared expression language (M4 slice).

Used for workflow transition guards (and later: validation, ABAC, KPIs). Evaluated in a
sandbox (no builtins, no attribute access) via simpleeval. The production target is CEL
(per the blueprint); this is a safe subset to prove the engine.

Cross-record reach (M1 Phase 1.5 — sealed GXL Extension addendum,
`docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md`): a guard may
reach ONE hop into a linked record via a `ref` FieldDef — e.g. `account.balance_due == 0`.
`validate_guard` is the AST pre-scan that enforces the sealed grammar (single hop, no calls)
*before* any DB call; `app.workflow.resolve_cross_record` does the actual single-query pre-fetch
and injects the linked row's `data` dict into the evaluation context, where simpleeval's
ATTR_INDEX_FALLBACK turns `account.balance_due` into `account['balance_due']`.
"""
import ast

from simpleeval import EvalWithCompoundTypes, NameNotDefined


class GXLError(ValueError):
    """A guard expression violates the sealed GXL grammar (forbidden patterns GXL-F1..F5).

    Raised at *authorship* time (write-time validation in `routers/meta.py`) and at the start of
    guard evaluation (the resolver's pre-scan in `app.workflow.resolve_cross_record`). All five
    forbidden patterns are HARD per the addendum — there is no fall-through to a runtime surprise.
    """


# Aggregate-style call names get the tailored GXL-F1 message; every other call is GXL-F3/F5.
_AGGREGATE_NAMES = frozenset({
    "count", "sum", "any", "all", "every", "some",
    "avg", "min", "max", "len", "size", "first", "last",
})


def validate_guard(expr: str | None) -> set[str]:
    """AST pre-scan of a guard expression per the sealed GXL Extension addendum (§2.1, §5).

    Returns the set of single-hop *ref keys* the expression reaches across — the NAME before a
    single dot, e.g. ``{"account"}`` for ``account.balance_due == 0 and account.status == 'X'``.
    An empty/None guard, or one with no cross-record reach, returns an empty set.

    Raises GXLError on any forbidden pattern, BEFORE any DB call:
      * GXL-F2  multi-hop ref (``a.b.c``) — the value before a dot must be a bare name.
      * GXL-F1  aggregate over a collection (``count(x)``, ``sum(x)`` …).
      * GXL-F3/F5  any function call (``now()``, ``random()``, ``http_get()`` …) — guards are pure.
      * GXL-F4  identifier escaping SQL — structurally impossible: ``ast.parse`` only yields valid
                Python identifiers, and the resolver parameterises the ref *value* and never
                interpolates the ref *key* into SQL.
    """
    if not expr or not expr.strip():
        return set()
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise GXLError(f"guard is not a valid expression: {e}") from e

    refs: set[str] = set()
    for node in ast.walk(tree):
        # GXL-F1 / F3 / F5 — guards are pure expressions of state; no function calls of any kind.
        if isinstance(node, ast.Call):
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None) or "?"
            if name in _AGGREGATE_NAMES:
                raise GXLError(
                    "GXL guards reach exactly one record per ref; aggregates over collections are "
                    "forbidden. Express collection-derived state as a denormalized field on the record."
                )
            raise GXLError(
                "GXL guards are pure expressions of record state — function calls like "
                f"{name}(...) are not allowed (no aggregates, no now()/random(), no external lookups)."
            )
        # GXL-F2 — single hop only: the thing before a dot must be a bare name, never another attr.
        if isinstance(node, ast.Attribute):
            if not isinstance(node.value, ast.Name):
                raise GXLError(
                    "GXL guards may dereference at most one level (`account.balance_due` is OK, "
                    "`account.holder.name` is not). If you need a two-hop value, denormalize it onto "
                    "the first hop."
                )
            if node.attr.startswith("_"):
                raise GXLError("GXL guards may not reference attributes starting with '_'.")
            refs.add(node.value.id)
    return refs


def evaluate(expr: str | None, context: dict) -> bool:
    """Evaluate a boolean guard expression against a context of field values.

    Empty/None guard → always True (no guard). Unknown names resolve to None so a missing
    field reads as null rather than erroring.
    """
    if not expr:
        return True
    evaluator = EvalWithCompoundTypes(names=dict(context))
    # Cross-record reach: a linked record is injected into the context as a dict (e.g.
    # context["account"] = {"balance_due": 0}); ATTR_INDEX_FALLBACK lets `account.balance_due`
    # fall back to `account["balance_due"]`. It defaults True in simpleeval — pin it explicitly
    # so a future simpleeval default flip can't silently break cross-record guards.
    evaluator.ATTR_INDEX_FALLBACK = True
    try:
        return bool(_eval_with_default_none(evaluator, expr))
    except Exception:
        # a broken guard is treated as not-satisfied (fail closed)
        return False


def _eval_with_default_none(evaluator: EvalWithCompoundTypes, expr: str):
    try:
        return evaluator.eval(expr)
    except NameNotDefined as e:
        # define the missing name as None and retry (bounded by number of distinct names)
        name = getattr(e, "name", None)
        if not name:
            raise
        evaluator.names[name] = None
        return _eval_with_default_none(evaluator, expr)
