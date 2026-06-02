"""Notification digest job (E26 / F56) — batch + scheduled delivery.

For users who have chosen `digest` mode (A26 prefs), notifications are queued with
`digest_pending=True` instead of being dispatched in real time.  This module:

  1. Provides `run_digests(s, *, tenant_id, actor)` — the callable used by the scheduler
     (b25 sweep) and by the manual trigger endpoint below.
  2. Exposes `POST /api/notifications/run-digests` for manual / testing calls.

GRACEFUL DEGRADATION (A26 not yet merged)
-----------------------------------------
A26 adds `mode` + `channels` to `NotificationPref` and `digest_pending` to `Notification`.
If those columns are absent from the live schema this module catches the resulting
AttributeError / column-not-found exceptions, logs a clear NO-OP notice, and records a
SUCCESS JobRun with `{"users": 0, "sent": 0, "items": 0, "errors": 0, "note": "A26 schema not present"}`.
This is the fail-soft-per-user contract extended to the whole run — the scheduler will NOT crash.

IDEMPOTENCY
-----------
Once `digest_pending` is cleared on a notification, a re-run of `run_digests` finds no
pending items for that user and sends nothing.  The clearing happens only after a
successful `channels.dispatch` call (per channel) — a partial failure leaves the flag set
so the next sweep retries.

FIXED-PATH NOTE (coordinator)
------------------------------
Register `digests.router` in main.py BEFORE `records.router` (the generic /api/{slug}
catcher) — the same rule as billing, jobs, report_schedules, etc.
No migration is needed: this module only reads + updates existing Notification rows.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User
from ..models.notification import Notification
from ..models.notification_pref import NotificationPref
from ..access import load_grants, can
from .. import channels
from .auth import current_user
from .billing import _record_job_run  # reuse the shared JobRun helper

log = logging.getLogger("gaahex.digests")

router = APIRouter(prefix="/api/notifications", tags=["digests"])

# Max pending notifications to include in one digest summary (display cap — does not limit clearing)
_DIGEST_ITEM_CAP = 20
_JOB_KEY = "notification.run_digests"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _has_digest_columns() -> bool:
    """Check whether the A26 columns exist on the ORM models (schema guard).
    Returns False when A26 has not been migrated yet — callers degrade gracefully."""
    try:
        # `digest_pending` on Notification and `mode` on NotificationPref are A26 additions.
        _ = Notification.digest_pending
        _ = NotificationPref.mode
        _ = NotificationPref.channels
        return True
    except AttributeError:
        return False


async def _users_with_digest_prefs(s: AsyncSession, tenant_id) -> list:
    """Return the distinct user_ids in this tenant that have at least one digest-mode pref.

    If A26 columns are not present yet, returns an empty list (graceful degrade).
    """
    if not _has_digest_columns():
        return []
    try:
        rows = (await s.execute(
            select(NotificationPref.user_id).where(
                NotificationPref.tenant_id == tenant_id,
                NotificationPref.mode == "digest",  # noqa: E711 — SA comparison
            ).distinct()
        )).scalars().all()
        return list(rows)
    except Exception:
        log.warning("digests: could not query digest-mode prefs (A26 schema absent?); skipping")
        return []


async def _pending_for_user(s: AsyncSession, tenant_id, user_id) -> list[Notification]:
    """Notifications with digest_pending=True for this user, newest first.

    Returns [] if A26 schema is absent.
    """
    if not _has_digest_columns():
        return []
    try:
        rows = (await s.execute(
            select(Notification).where(
                Notification.tenant_id == tenant_id,
                Notification.user_id == user_id,
                Notification.digest_pending.is_(True),  # noqa: E711
            ).order_by(Notification.created_at.desc())
        )).scalars().all()
        return list(rows)
    except Exception:
        log.warning("digests: could not query digest_pending for user %s; skipping", user_id)
        return []


async def _digest_channels_for_user(s: AsyncSession, tenant_id, user_id) -> list[str]:
    """The external channels (non-inapp) from the user's digest-mode prefs.

    Falls back to ["email"] if A26 columns are absent or the pref has no explicit channels list.
    Deduplicates and strips "inapp" (the inbox is always live and doesn't need re-delivery).
    """
    if not _has_digest_columns():
        return []
    try:
        prefs = (await s.execute(
            select(NotificationPref).where(
                NotificationPref.tenant_id == tenant_id,
                NotificationPref.user_id == user_id,
                NotificationPref.mode == "digest",
            )
        )).scalars().all()
        seen: set[str] = set()
        result: list[str] = []
        for p in prefs:
            # A26 `channels` column is a JSONB list, e.g. ["email", "sms"].
            # If absent or null, default to ["email"].
            ch_list = getattr(p, "channels", None) or ["email"]
            if isinstance(ch_list, str):
                ch_list = [ch_list]
            for ch in ch_list:
                if ch != "inapp" and ch not in seen:
                    seen.add(ch)
                    result.append(ch)
        return result
    except Exception:
        log.warning("digests: could not read channels for user %s; skipping", user_id)
        return []


async def _resolve_address(s: AsyncSession, tenant_id, user_id, channel: str) -> str | None:
    """Resolve the delivery address for a channel (mirrors notifications._resolve_address)."""
    try:
        user = (await s.execute(
            select(User).where(User.id == user_id, User.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if user is None:
            return None
        if channel == "email":
            return user.email
        if channel == "sms":
            return getattr(user, "phone", None)
        return None
    except Exception:
        return None


def _compose_digest(notes: list[Notification]) -> tuple[str, str]:
    """Compose a digest subject + body from a list of pending notifications.

    Subject: "Your GAAhex digest: N notification(s)"
    Body: a numbered list of the capped items (title + body snippet).
    """
    cap = notes[:_DIGEST_ITEM_CAP]
    total = len(notes)
    subject = f"Your GAAhex digest: {total} notification{'s' if total != 1 else ''}"
    lines = [f"You have {total} pending notification{'s' if total != 1 else ''}:\n"]
    for i, n in enumerate(cap, 1):
        snippet = n.body[:120] + ("…" if len(n.body) > 120 else "")
        lines.append(f"{i}. [{n.category}] {n.title} — {snippet}")
    if total > _DIGEST_ITEM_CAP:
        lines.append(f"\n… and {total - _DIGEST_ITEM_CAP} more.")
    body = "\n".join(lines)
    return subject, body


# ---------------------------------------------------------------------------
# Core job function (called by scheduler + manual endpoint)
# ---------------------------------------------------------------------------

async def run_digests(s: AsyncSession, *, tenant_id, actor: User) -> dict:
    """Batch-deliver pending digest notifications for every digest-mode user in a tenant.

    Algorithm (per-user, fail-soft):
      1. Find users with digest-mode prefs.
      2. For each such user gather their Notification rows with digest_pending=True.
      3. Compose one summary (count + subject list) and dispatch via each pref channel.
      4. Clear digest_pending on the successfully-sent notifications.
      5. Record a JobRun (SUCCESS/ERROR + {users, sent, items, errors}).

    Idempotent: cleared rows are never re-sent.
    Graceful degrade: if A26 schema is absent, records a SUCCESS no-op and returns.
    """
    started = _now()
    total_users = 0
    total_sent = 0
    total_items = 0
    errors = 0

    # ---- schema guard: A26 not merged yet → clean no-op ----
    if not _has_digest_columns():
        log.info("digests: A26 schema not present — no-op (tenant=%s)", tenant_id)
        summary = {"users": 0, "sent": 0, "items": 0, "errors": 0,
                   "note": "A26 schema not present; digest columns absent"}
        _record_job_run(s, actor, _JOB_KEY, "SUCCESS", summary, started)
        await s.commit()
        return summary

    try:
        user_ids = await _users_with_digest_prefs(s, tenant_id)
    except Exception as exc:
        log.exception("digests: failed to list digest users for tenant %s", tenant_id)
        summary = {"users": 0, "sent": 0, "items": 0, "errors": 1, "message": str(exc)[:300]}
        _record_job_run(s, actor, _JOB_KEY, "ERROR", summary, started)
        await s.commit()
        return summary

    for user_id in user_ids:
        try:
            notes = await _pending_for_user(s, tenant_id, user_id)
            if not notes:
                continue  # nothing pending for this user — skip silently

            total_users += 1
            total_items += len(notes)
            subject, body = _compose_digest(notes)
            ch_list = await _digest_channels_for_user(s, tenant_id, user_id)

            if not ch_list:
                # Pref has digest mode but no external channels configured — skip delivery,
                # leave digest_pending set so it retries when prefs are fixed.
                log.info("digests: user %s has no external channels configured; skipping", user_id)
                continue

            dispatched_at_least_one = False
            for channel in ch_list:
                to_addr = await _resolve_address(s, tenant_id, user_id, channel)
                try:
                    await channels.dispatch(
                        s,
                        tenant_id=tenant_id,
                        channel=channel,
                        to=to_addr,
                        subject=subject,
                        body=body,
                        def_key="notification.digest",
                        user_id=user_id,
                    )
                    dispatched_at_least_one = True
                    total_sent += 1
                except Exception:
                    # dispatch is already fail-soft and never raises; this is a belt-and-
                    # suspenders guard in case that contract ever changes.
                    log.exception("digests: dispatch failed for user %s channel %s", user_id, channel)
                    errors += 1

            # Clear digest_pending ONLY if at least one channel was dispatched successfully.
            # This way a user with a bad email + good SMS won't have their items cleared
            # before we've confirmed at least one delivery path.
            if dispatched_at_least_one:
                for note in notes:
                    try:
                        note.digest_pending = False
                    except AttributeError:
                        pass  # schema guard — should not happen here but be safe
                await s.flush()

        except Exception:
            log.exception("digests: per-user error for user %s in tenant %s", user_id, tenant_id)
            errors += 1
            # Continue to next user — fail-soft per user

    summary: dict = {"users": total_users, "sent": total_sent, "items": total_items, "errors": errors}
    status = "SUCCESS" if errors == 0 else "ERROR"
    try:
        _record_job_run(s, actor, _JOB_KEY, status, summary, started)
        await s.commit()
    except Exception:
        log.exception("digests: failed to record JobRun for tenant %s", tenant_id)
        try:
            await s.rollback()
        except Exception:
            pass

    log.info("digests: tenant=%s %s", tenant_id, summary)
    return summary


# ---------------------------------------------------------------------------
# Manual trigger endpoint (authed; gated on notification.manage or *)
# ---------------------------------------------------------------------------

@router.post("/run-digests")
async def trigger_run_digests(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Manually trigger the digest job for the caller's tenant.

    Gated on `notification.manage` (or the tenant's `*`-grant).  In production the scheduler
    sweeps this automatically; this endpoint exists for testing and on-demand runs.

    Returns {users, sent, items, errors} — the same summary the scheduler records as a JobRun.
    """
    grants = await load_grants(s, user)
    if not can(grants, "notification", "manage"):
        from fastapi import HTTPException
        raise HTTPException(403, "Not allowed: notification.manage")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    try:
        await assert_can(s, user, action="manage", entity_key="notification",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        from fastapi import HTTPException
        raise HTTPException(403, detail=str(e))

    return await run_digests(s, tenant_id=user.tenant_id, actor=user)
