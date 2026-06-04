"""Generate frontend/src/generated/permissions.ts from `seed._permission_specs`.

PC-3 — backend RBAC permission keys are the single source of truth. The
frontend used to reference them as string literals scattered across views;
any rename required a grep-driven manual sweep. This generator collects the
keys from `app.seed._permission_specs` (which is the bulk-insert source for
the demo tenant's PermissionDef rows) and emits a nested const object so
views can `import { Perms } from '../generated/permissions'` and use
`Perms.invoice.manage` instead of `"invoice.manage"`.

Re-run after any change to `_permission_specs`. A CI rule (Phase 6) will
guard that the committed `permissions.ts` matches a fresh regen — any
backend-side rename will surface as a TS compile failure across the
frontend instead of a silent run-time miss.

Usage (from repo root):
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\gen_permissions_ts.py
"""
from __future__ import annotations

import sys
import uuid
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

OUTPUT = REPO / "frontend" / "src" / "generated" / "permissions.ts"


def collect_keys() -> list[str]:
    from app.seed import _permission_specs
    dummy_tenant = uuid.uuid4()
    specs = _permission_specs(dummy_tenant)
    keys = sorted({str(s["key"]) for s in specs if isinstance(s, dict) and "key" in s})
    return keys


def to_ts(keys: list[str]) -> str:
    # Group by first dotted segment so callers get `Perms.invoice.manage`.
    groups: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for key in keys:
        if "." not in key:
            groups[key].append(("__self", key))
            continue
        ns, _, verb = key.partition(".")
        groups[ns].append((verb, key))

    lines: list[str] = []
    lines.append("// PC-3 — AUTO-GENERATED from backend/app/seed.py:_permission_specs.")
    lines.append("// Do not edit by hand. Regenerate with:")
    lines.append("//   backend\\\\.venv\\\\Scripts\\\\python.exe backend\\\\scripts\\\\gen_permissions_ts.py")
    lines.append("//")
    lines.append("// Each value is the canonical `object.action` string accepted by `can()` in")
    lines.append("// `frontend/src/lib/capabilities.ts` and by the backend `access.py` checks.")
    lines.append("")
    lines.append("export const Perms = {")
    for ns in sorted(groups):
        verbs = sorted(set(groups[ns]))
        # Replace any TS reserved word that could land as a key.
        if all(v == "__self" for v, _ in verbs):
            lines.append(f"  {js_key(ns)}: '{ns}' as const,")
        else:
            lines.append(f"  {js_key(ns)}: {{")
            for verb, full in verbs:
                if verb == "__self":
                    continue
                lines.append(f"    {js_key(verb)}: '{full}' as const,")
            lines.append("  },")
    lines.append("} as const")
    lines.append("")
    lines.append("// String-literal type covering every permission key.")
    lines.append("export type PermissionKey =")
    for i, key in enumerate(keys):
        suffix = "" if i == len(keys) - 1 else ""
        lines.append(f"  | '{key}'{suffix}")
    lines.append("")
    return "\n".join(lines)


def js_key(name: str) -> str:
    """Quote a JS object key if it isn't a bare identifier."""
    if name.isidentifier() and not name[0].isdigit():
        return name
    return f"'{name}'"


def main() -> None:
    keys = collect_keys()
    if not keys:
        print("WARN: no permission keys collected; aborting", file=sys.stderr)
        sys.exit(1)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(to_ts(keys), encoding="utf-8")
    print(f"Wrote {len(keys)} permissions to {OUTPUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
