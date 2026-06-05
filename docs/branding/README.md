# GAAhex — Branding

## ✅ Canonical brand baseline: **Brand v3.0 — LOCKED 2026-06-06**

The certified, production-ready brand source-of-truth is **[`v3.0/`](./v3.0/)**.
Treat that directory as read-only canonical. Every brand-touching decision in the
project — logos, color, typography, voice, naming, brand architecture — reads from
there.

### Quick links

- **Entry point:** [`v3.0/README.md`](./v3.0/README.md)
- **Status snapshot:** [`v3.0/16-BRAND-STATUS.md`](./v3.0/16-BRAND-STATUS.md)
- **Changelog (full v1.0 → v3.0 evolution):** [`v3.0/CHANGELOG.md`](./v3.0/CHANGELOG.md)
- **Master Specification:** [`v3.0/08-docs/GAAhex_Brand_Master_Specification_v3.0.md`](./v3.0/08-docs/GAAhex_Brand_Master_Specification_v3.0.md)
- **Operations Manual:** [`v3.0/08-docs/GAAhex_Brand_Operations_Manual_v3.0.md`](./v3.0/08-docs/GAAhex_Brand_Operations_Manual_v3.0.md)
- **D18 Color Architecture (authoritative):** [`v3.0/08-docs/GAAhex_D18_Color_Architecture_v2.0.md`](./v3.0/08-docs/GAAhex_D18_Color_Architecture_v2.0.md)
- **Developer integration guide:** [`v3.0/dev-package/INTEGRATION.md`](./v3.0/dev-package/INTEGRATION.md)
- **Trademark Usage Policy:** [`v3.0/16-governance/trademark/Trademark_Usage_Policy.md`](./v3.0/16-governance/trademark/Trademark_Usage_Policy.md)
- **Integrity manifest:** [`v3.0/MANIFEST.sha256`](./v3.0/MANIFEST.sha256)
- **License:** [`v3.0/LICENSE.txt`](./v3.0/LICENSE.txt)

### Source-of-truth files

| Purpose | Location |
|---|---|
| Brand spec | `v3.0/08-docs/GAAhex_Brand_Master_Specification_v3.0.md` |
| Color architecture | `v3.0/08-docs/GAAhex_D18_Color_Architecture_v2.0.md` |
| Operations / day-to-day usage | `v3.0/08-docs/GAAhex_Brand_Operations_Manual_v3.0.md` |
| Logo masters (vector) | `v3.0/00-source/gaahex-master.{ai,svg,eps,pdf}` |
| Logo lockups (every variant) | `v3.0/01-logo/{horizontal,vertical,stacked,icon,monogram,secondary,wordmark}/` |
| Web-app assets | `v3.0/02-web-app/` |
| Favicons | `v3.0/03-favicon/` (+ `head-snippet.html`) |
| PWA icons | `v3.0/04-pwa/` |
| Social graphics | `v3.0/05-social/` |
| Design tokens (7 formats) | `v3.0/11-figma/tokens/gaahex-tokens.{css,scss,js,ts,json,swift,xml}` |
| Animations (SVG · Lottie · GIF) | `v3.0/09-animated/` |
| Accessibility variants | `v3.0/15-accessibility/` |
| Governance / audits | `v3.0/16-governance/audits/` |
| Trademark | `v3.0/16-governance/trademark/` |
| React drop-in | `v3.0/dev-package/GaahexLogo.jsx` |

### D18 Color Architecture (authoritative — one family, one role)

| Family | Role | Hex anchor |
|---|---|---|
| **Cobalt** | Brand spine — structural chrome | `#1C3B68` |
| **Gold** | Brand signature — peak / destination moments | `#C5A059` (dark) · `#AC8847` (light) |
| **Azure** | Interactive — every clickable affordance | `#0EA5E9` |
| **Slate** | Neutrals — text, borders, dividers (~90% of UI) | grayscale spine |
| **Semantic** | Status only — success / warning / danger / info + operational | (see token files) |

Roles **never overlap**. Hover affordance on an interactive element uses Azure;
hover affordance on a container card uses Gold. See `v3.0/08-docs/` for the full
spec.

### Trademark

The canonical brand name is **GAAhex™** (™ now; ® only after registration). See
[`v3.0/16-governance/trademark/Trademark_Usage_Policy.md`](./v3.0/16-governance/trademark/Trademark_Usage_Policy.md)
for full usage rules.

### Integrity

Verify the package matches its release fingerprint:

```bash
cd docs/branding/v3.0 && sha256sum -c MANIFEST.sha256
```

The original certified zip is held at `D:\GAAhex-Brand-v3.0-Final (1).zip`
(sha256 `fc064019973597e19f05a45717a7506b55d8fbc4e71565803ecb6b9d46f80dfa`).

## Runtime asset path map

What the frontend actually uses, and where the v3.0 source comes from:

| Frontend runtime path | v3.0 canonical source |
|---|---|
| `frontend/public/logo/GAAhex-logo-cobalt-gold.svg` | `v3.0/01-logo/horizontal/gaahex-logo-horizontal-color.svg` |
| `frontend/public/logo/GAAhex-logo-reversed.svg` | `v3.0/01-logo/horizontal/gaahex-logo-horizontal-dark.svg` |
| `frontend/public/logo/GAAhex-mark.svg` | `v3.0/01-logo/icon/gaahex-icon-color.svg` |
| `frontend/public/favicon/favicon.svg` | `v3.0/03-favicon/favicon.svg` |
| `frontend/public/favicon/favicon.ico` | `v3.0/03-favicon/favicon.ico` |
| `frontend/public/favicon/favicon-{16x16,32x32,48x48}.png` | `v3.0/03-favicon/favicon-{16,32,48}.png` |
| `frontend/public/app-icons/apple-touch-icon.png` | `v3.0/04-pwa/apple-touch-icon.png` |
| `frontend/public/app-icons/icon-192.png` | `v3.0/04-pwa/pwa-192.png` |
| `frontend/public/app-icons/icon-512.png` | `v3.0/04-pwa/pwa-512.png` |
| `frontend/public/app-icons/icon-maskable-512.png` | `v3.0/04-pwa/pwa-512-maskable.png` |
| `frontend/public/social/og-image.png` | `v3.0/05-social/og-default.png` |

The pre-v3.0 versions of these files are archived under
`frontend/public/_archive-pre-v3.0/` for emergency rollback only — they are NOT
served and are NOT canonical.

## Historical trail (do not delete, do not promote)

The root of `docs/branding/` holds **decision-trail and research files** that
preceded the v3.0 certification:

- `AUDIT.md`, `LOGO_BRIEF.md`, `PROPOSAL.md` — the brief and audit that informed v3.0
- `VOICE_GUIDE.md` — voice tone (orthogonal to visual brand)
- `SWEEP_SPEC_2026-06-04.md`, `sweep-baseline-2026-06-04.txt`, `sweep-verification-2026-06-04.txt`, `voice-sweep-2026-06-04.md` — content-pass records
- `gx-to-repo-mapping.md` — token-to-codebase mapping notes
- `_research/` — industry research (Linear, Stripe, Mailchimp voice, Vercel Geist, etc.)
- `logo-proposals/` — early proposal SVGs; v3.0 is the chosen direction

These files exist for context. **Where they disagree with v3.0, v3.0 wins.**

## Binding rules (every future contributor)

1. **Do not redesign, reinterpret, or "improve" the brand.** v3.0 is LOCKED.
2. **Logo geometry / spacing / typography / brand architecture: unchanged.**
3. **D18 = Cobalt spine · Gold signature · Azure interactive · Slate neutrals · Semantic status.** One family, one role; no overlap.
4. **New assets must derive from** `v3.0/00-source/gaahex-master.{ai,svg,eps,pdf}`.
5. **Trademark:** GAAhex™. See `v3.0/16-governance/trademark/`.
6. **No connector / mesh lines** anywhere (per v3.0 spec).
7. **Future asset rotation** (replacing runtime files with new v3.0 derivatives) must mirror the source canonical, not improvise.

A change that would relax any of these is a sealed-baseline conversation, not a casual PR.
