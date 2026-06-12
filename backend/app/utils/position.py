"""Shared validator for an image focal point expressed as a CSS object-position ("x% y%").

Used by the avatar (me.py) and logo (tenant_settings.py) position pickers. The stored value drops
straight into an `<img style="object-position: ...">`, so it must be tightly validated — exactly two
0–100 percentages, nothing else — to keep it injection-safe.
"""
import re

from fastapi import HTTPException

_POS_RE = re.compile(r"^(\d{1,3}(?:\.\d+)?)% (\d{1,3}(?:\.\d+)?)%$")


def validate_object_position(v: str | None) -> str | None:
    """Validate/normalize a focal point like "50% 40%". None/empty ⇒ None (center default).
    Anything that isn't two 0–100 percentages ⇒ 422."""
    if v is None:
        return None
    v = v.strip()
    if v == "":
        return None
    m = _POS_RE.match(v)
    if not m:
        raise HTTPException(422, 'position must be "x% y%" (two percentages, e.g. "50% 40%")')
    x, y = float(m.group(1)), float(m.group(2))
    if not (0 <= x <= 100 and 0 <= y <= 100):
        raise HTTPException(422, "position percentages must be between 0 and 100")
    return f"{x:g}% {y:g}%"
