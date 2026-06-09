# Soft-Delete Patterns — Implementation Reference

> Status: LOCKED (supplements Standard 12 — Deletion / Archive / Restore Standard)
>
> This note clarifies the *implementation choice* between two co-existing patterns
> in the codebase. Both are correct; which one to use depends on the entity type.

---

## Background

Standard 12 (file 12, D14) mandates:
- `deletion_state` is a **separate field and enum** from the object's lifecycle `status`.
- The `DeletionState` enum has five values: `ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED`.
- Audit / event records remain permanent.

Within that envelope, two concrete patterns exist in the platform:

---

## Pattern A — `deleted_at` (timestamp-only soft delete)

**Used for:** simple content objects whose removal is a user action with no downstream
workflow consequence (no approval gate, no archive/restore lifecycle, no purge scheduling).

**Columns added to the model:**
```python
deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
deleted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
```

`NULL` = live row. Non-NULL = soft-deleted at that timestamp by that user.
The router returns a tombstone response ("Comment Deleted", "Attachment Deleted") rather
than a 404.

**Canonical examples in the codebase:**
- `backend/app/models/comment.py` — `Comment.deleted_at` / `Comment.deleted_by`
- `backend/app/models/attachment.py` — `Attachment.deleted_at` / `Attachment.deleted_by`

**Why not `deletion_state` here:** these objects are created and removed by end users as
lightweight content. There is no archive / restore / purge-scheduling lifecycle; a
two-value boolean (live / deleted) expressed as a nullable timestamp is sufficient and
keeps the query predicate simple (`WHERE deleted_at IS NULL`).

---

## Pattern B — `deletion_state` + timestamps (full D14 lifecycle)

**Used for:** workflow-driven objects whose removal must pass through an approval gate,
may be archived and restored, or may be subject to retention-based purge scheduling.
These objects are business records, not user content.

**Columns added to the model (use the applicable subset):**
```python
deletion_state: Mapped[str] = mapped_column(
    String(20), nullable=False, default="ACTIVE", server_default="'ACTIVE'"
)
archived_at:   Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
deleted_at:    Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
restored_at:   Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

The `deletion_state` enum drives the router / kernel logic.  The timestamp companions
(`archived_at`, `deleted_at`, `restored_at`) record *when* each state was entered.
Note that `deleted_at` is still present here — it records the moment the row moved to
`SOFT_DELETED`, it is NOT a standalone soft-delete signal (the `deletion_state` column is).

**Canonical examples in the codebase:**
- `backend/app/models/approval.py` — `Approval.deletion_state` / `PendingApproval.deletion_state`
  (approval decisions are business records subject to retention rules and audit permanence)

---

## Decision guide

| Entity characteristic | Use Pattern |
|---|---|
| Content created/removed by a user action (no workflow) | A — `deleted_at` |
| Business record with archive / restore / purge lifecycle | B — `deletion_state` |
| Any object already carrying a `status` lifecycle field | B — D14 mandates separation |
| Approval, PendingApproval, WorkItem, Invoice, Order, etc. | B — `deletion_state` |
| Comment, Attachment, Mention, Reference | A — `deleted_at` |

When in doubt, apply Pattern B — it is the superset and always Standard-12 compliant.
Pattern A is an intentional simplification for objects where the full D14 lifecycle
would add overhead with no business value.

---

## See also

- Standard 12 (`docs/standards/12-final-architecture-standards.md`) — canonical rule
- `docs/standards/14-enum-registry.md` — `DeletionState` enum definition
- `docs/standards/16-global-status-standard.md` — D14 clarification (deletion_state ≠ status)
