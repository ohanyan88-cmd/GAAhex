"""Current-user self-service: avatar upload + change password.

Both endpoints act ONLY on the authenticated caller's own app_user row — there is no user-id in the
path, the principal comes from `current_user`. Re-fetch the row on the RLS-subject request session
`s` (the tenant GUC is set by the auth dependency), mirroring how tenant_settings.py re-loads the
Tenant: the `User` handed in by Depends(current_user) was loaded on a detached OWNER session, so we
reload it on `s` to UPDATE under the row's own tenant policy (WITH CHECK passes — same tenant).

Avatar storage: a base64 `data:` URL on app_user.avatar_url. This codebase serves no static files
and runs in-process / containerized, so a data URL is the cleanest robust choice — it travels with
the (RLS-scoped) row, survives restarts, needs no shared volume, and drops straight into an <img src>.

Fixed paths under /api ("/api/me"), so this router is registered BEFORE records.router ("/api/{slug}").
"""
import base64
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..security import hash_password, verify_password
from .auth import current_user

router = APIRouter(prefix="/api/me", tags=["me"])

# Avatar upload limits.
MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 2 MB
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}

# Password policy (min length per task spec; 400 on violation so the frontend sees a clean error).
MIN_PASSWORD_LENGTH = 8


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


async def _own_row(s: AsyncSession, user: User) -> User:
    """Reload the caller's own app_user row on the RLS-subject request session so we can UPDATE it
    (the dependency-injected `user` is detached from `s`). The tenant GUC is already set, so the
    row resolves under tenant_isolation; missing ⇒ 404 (should not happen for an authed caller)."""
    row = (await s.execute(select(User).where(User.id == user.id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "User not found")
    return row


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Upload a profile image (multipart field `file`). Validates it is an image and ≤2MB, stores it
    as a base64 data URL on the user row, and returns {"avatar_url": "data:<mime>;base64,..."}."""
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, f"File must be an image ({', '.join(sorted(ALLOWED_IMAGE_TYPES))})")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(400, "Image too large (max 2MB)")

    data_url = f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}"

    row = await _own_row(s, user)
    row.avatar_url = data_url
    await s.commit()
    return {"avatar_url": data_url}


@router.post("/password")
async def change_password(
    body: PasswordChangeIn,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Change the caller's password. Verifies `current_password` against the stored hash, enforces a
    min length of 8 on `new_password`, and stores the new bcrypt hash. 400 on any rule violation."""
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    if len(body.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"New password must be at least {MIN_PASSWORD_LENGTH} characters")

    row = await _own_row(s, user)
    row.password_hash = hash_password(body.new_password)
    # Stamp the change so /auth/login stops returning must_change_password=true for this user
    # (the forced-first-login flow for the seeded default admin keys off NULL here).
    row.password_changed_at = datetime.now(timezone.utc)
    await s.commit()
    return {"ok": True}
