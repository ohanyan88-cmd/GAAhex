# Final Locked Standards — GAAex Platform

Status: LOCKED (normalized, consistency-patched)
Patch date: 2026-06-02

This folder is the single source of truth for all platform standards after the
cross-standard consistency patch. Every standard here is LOCKED.

## How to read this set

- `00-standards-index.md` is the canonical index. Standards are keyed by **name**;
  the display number is ordering only and is never a business value.
- Each `NN-*.md` file groups related standards.
- `13-consistency-patch-notes.md` records every fix applied in this patch.

## Patch summary

Five blockers, five structural fixes, and two minor clarifications were applied:

- B1 — all canonical enum/status values normalized to `UPPER_SNAKE_CASE`.
- B2 — Event primary `id` is UUIDv7; `EVT-000001` is its reference number.
- B3 — one canonical `ActorType` enum across all standards.
- B4 — timelines are projections of the Event System; one event may appear on multiple timelines.
- B5 — exactly one accountable Owner Department per stage; others are supporting departments.
- S1 — one canonical, collision-free standards index.
- S2 — the locked navigation tree is the only navigation source of truth.
- S3 — Strategic Product Direction references the implementable UI standards instead of redefining them.
- S4 — the `pipeline` page type supports multiple tabbed pipeline views.
- S5 — every business-visible object has a UUIDv7 `id` and a registered reference prefix.
- M1 — `CorrelationID` / `CausationID` are internal trace keys, exempt from the Reference Number Standard.
- M2 — modal scope clarified; large/complex editing uses drawers or dedicated pages.

## Second patch (deep audit, D1–D16)

- D1 tenantId added to events & audit; D2 field names normalized to camelCase; D3 one canonical
  ObjectType enum; D4/D13 one object-detail tab set (Activity folded into Timeline); D5/D12 split
  ActorType (performer) vs PrincipalType (referenced); D6 Enum Registry (file 14); D7 Permission
  Registry (file 15); D8 prefix registry completed; D9 webhook removed from notification channels;
  D10 one CommunicationChannel enum; D11 escalation-to-queue is a move; D14 deletionState separate
  from status; D15 mention targets UPPER_SNAKE; D16 notification stores eventId.

## Known gap

Seven standards are referenced as LOCKED throughout the set but their source text
was not provided to this patch. They are present in the index and as placeholder
files marked `SOURCE NOT PROVIDED` and must be supplied before the set is complete:

1. Global Status Standard
2. Automation Standard
3. Integration Standard
4. Security & Permission Standard
5. Data Validation Standard
6. Search & Filter Standard
7. Navigation Standard (base behavior; the locked navigation **tree** is provided)

Placeholders contain no invented rules.
