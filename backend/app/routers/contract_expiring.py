"""Contracts about to expire — for the B2B AM "Renewal Watch" widget."""
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from .auth import current_user

router = APIRouter(prefix="/api", tags=["contracts"])


@router.get("/contracts/expiring")
async def contracts_expiring(within_days: int = 90,
                              user: User = Depends(current_user),
                              s: AsyncSession = Depends(get_session)):
    """Contract records where data.end_date is between today and today+within_days, and
    status NOT in EXPIRED/TERMINATED. Returns each with id, customer, end_date, value,
    days_remaining (computed).
    """
    today = date.today()
    cutoff = today + timedelta(days=within_days)
    rows = (await s.execute(
        select(Record).where(
            Record.tenant_id == user.tenant_id,
            Record.entity_key == "contract",
        )
    )).scalars().all()
    out = []
    for r in rows:
        d = r.data or {}
        end_str = d.get("end_date")
        if not end_str:
            continue
        try:
            end_d = date.fromisoformat(end_str[:10])
        except (TypeError, ValueError):
            continue
        if r.status in ("EXPIRED", "TERMINATED"):
            continue
        if not (today <= end_d <= cutoff):
            continue
        out.append({
            "id":             str(r.id),
            "title":          d.get("title"),
            "customer":       d.get("customer"),
            "contract_number":d.get("contract_number"),
            "value":          d.get("value"),
            "end_date":       end_str,
            "days_remaining": (end_d - today).days,
            "status":         r.status,
        })
    out.sort(key=lambda x: x["days_remaining"])
    return out
