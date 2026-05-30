# Topbar P0 — Current header map

## 1. Current topbar — element-by-element inventory

| Element | File:Line | Handler / State / Wired-to | Keep or Remove |
|---|---|---|---|
| **Sidebar toggle** (PanelLeft) | App.tsx:413–424 | toggles `navOpen` (<900px) or `collapsed` (desktop) | **KEEP** |
| **Search bar** | App.tsx:426–430 | `onClick`: TODO comment — no handler wired; shows ⌘K hint | **REMOVE** |
| **Configure page** (conditional) | App.tsx:434–442 | only when `user?.can_configure && canConfigureThisPage && view.type !== 'studio'`; sets `cfgSlug` or `cfgPageKey` | **DECISION NEEDED** |
| **Create + menu** | App.tsx:444–463 | `createMenuOpen` state; 6 items (New lead/customer/invoice/ticket/event/entity-in-Studio) | **REMOVE** |
| **Theme toggle (standalone)** | App.tsx:465–472 | `theme` state; toggles dark/light + persists `gaaex-theme` in localStorage | **MOVE INTO USER MENU** |
| **Help (?)** icon | App.tsx:474–476 | no handler wired (aria-label only) | **REMOVE** |
| **Notifications** | App.tsx:478–485 | wraps `NotificationCenter` (full component ~220 LOC, real API) | **KEEP — rebuild as NotificationBell** |
| **Language switcher** (EN/AM/RU) | App.tsx:487–494 | `useI18n` hook, 3 buttons calling `setLang(l)` | **DECISION NEEDED** |
| **User avatar + menu** | App.tsx:496–565 | `userMenuOpen` state; chip = `avatar` button; menu = inline; opens sub-modals (Profile/Security/Shortcuts/Docs/WhatsNew) | **KEEP — restructure for new spec; theme moves here** |

Current order: sidebar toggle · search · spacer · configure-button (cond.) · create · theme · help · notifications · language · user-avatar.

## 2. New spec (Shell.jsx)

### OrgIdentity (left)
- `.org` button: `.org-badge` (46×46, logo or initials) + `.org-name` + `.org-edit` pencil
- Click → `.org-pop` popover: logo preview + Upload/Remove buttons + Company name input + Cancel/Save
- Kit persists to localStorage `gx-org`. **We wire to `/api/tenant/settings` (existing endpoint with `name` and now `logo_url`)**

### NotificationBell (right)
- `.tb-icon` button with `.ndot` (red dot if unread)
- `.notif-pop` dropdown: head (title + unread badge + "Mark all read") · list (`.notif-item.unread` with icon/title/body/time) · foot (Clear all + View all) · empty state ("You're all caught up")
- Shape: `{ id, icon, tone, title, body, t, read }[]`

### UserMenu (right)
- `.userchip` button: avatar 28×28 + `.userchip-name` + `.userchip-role` + chevron-down (text hidden <900px)
- Menu (`.user-pop`):
  - `.user-card` (avatar 42×42 + name + email)
  - My profile → switches to in-menu profile sub-view (key/value pairs + Edit profile button)
  - Account settings / Preferences / Theme toggle / Keyboard shortcuts / Sign out

Final order: `[PanelLeft] [OrgIdentity] ...spacer... [NotificationBell] [UserMenu]`. 56px sticky header.

## 3. CSS — port vs already in styles.css

| Selectors | Status |
|---|---|
| `.tb`, `.tb-icon`, `.spacer`, `.avatar` | EXISTS (styles.css ~1781) — reuse |
| `.tb-search`, `.kbd` | EXISTS — DELETE in P1 |
| `.org`, `.org-wrap`, `.org-badge`, `.org-name`, `.org-edit`, `.org-pop` | **NEW** — port from kit |
| `.notif-wrap`, `.notif-pop`, `.notif-head`, `.notif-list`, `.notif-item{,.unread,-ic,-foot}` | **NEW** — port from kit |
| `.userchip{,-meta,-name,-role}`, `.user-wrap`, `.user-pop`, `.user-card` | partial (`.user-menu` exists at ~280) — REDEFINE per kit |
| `.menu`, `.menu-item`, `.menu-sep` | EXISTS — reuse |

## 4. Mount point

Inline `<header className="tb">` inside `App` component (App.tsx ~412–566). Recommend KEEP inline — don't extract to `components/Topbar.tsx` yet; App.tsx is the single shell.

## 5. Open questions for Gev (5)

1. **Language switcher (EN/AM/RU)** — not in spec. Delete / move to user menu / keep?
2. **"Configure page" button** — not in spec. Move to page header / delete / keep?
3. **Notifications** — rebuild from kit (cleaner) vs wrap existing NotificationCenter (preserves preferences/snooze/archive)? Spec says "rebuild + wire to real notifications source" → rebuild + reuse NotificationCenter's API calls.
4. **OrgIdentity popover** — inline (kit pattern) vs Modal.tsx wrapper? Recommend inline (consistent with UserMenu / NotificationBell).
5. **Branding endpoint** — `/api/tenant/settings` already has `name` and `logo_text` fields. Use it for name + add `logo_url` upload OR new `/api/branding`? Recommend reuse `/api/tenant/settings`.

## 6. Branch strategy

Stay on `topbar/redesign`, commit per prompt (P1–P6), merge to `main` as one chunk after P6 verification. High-visibility change → reviewable end-to-end before landing.
