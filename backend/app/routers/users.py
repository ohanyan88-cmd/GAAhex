"""Users list endpoint (Batch 32): assignee/agent picker.

Read-only endpoint that serves assignment pickers across the app (WorkItems, Helpdesk).
Returns tenant-scoped users with safe serialization (no password_hash).
Optional ?q= substring filter on name/email (case-insensitive).
Gate: just current_user (any authenticated user may list their tenant's users).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func

from fastapi import APIRouter, Depends

from ..db import get_session
from ..models import User
from .auth import current_user

router = APIRouter(prefix="/api/users", tags=["users"])


def _user(u: User) -> dict:
    """Serialize a User for public consumption (no password_hash)."""
    return {
        "id": str(u.id),
        "name": u.name,
        "email": u.email,
        "primary_node_id": str(u.primary_node_id) if u.primary_node_id else None,
    }


@router.get("")
async def list_users(
    q: str | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List users in the caller's tenant for assignment pickers.

    Filter by User.tenant_id == caller's tenant_id.
    Optional ?q= substring filter on name/email (case-insensitive).
    Order by name (nulls last), then email.
    """
    query = select(User).where(User.tenant_id == user.tenant_id)

    if q:
        # Case-insensitive substring match on name or email
        q_lower = q.lower()
        query = query.where(
            (func.lower(User.name).contains(q_lower)) |
            (func.lower(User.email).contains(q_lower))
        )

    # Order by name (nulls last), then email
    query = query.order_by(User.name.asc().nullslast(), User.email.asc())

    rows = (await s.execute(query)).scalars().all()
    return [_user(u) for u in rows]
