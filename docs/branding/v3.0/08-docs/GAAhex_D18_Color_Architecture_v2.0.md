# GAAhex™ — D18 Color Architecture (Authoritative Standard)

**Status:** LOCKED LAW · **Version:** v2.0 · **Domain:** www.gaahex.com
**Supersedes:** all prior color guidance (Master Spec §3.4/§4.1 palette, legacy token names).
This document is the **sole source of truth** for GAAhex color. Where any other file conflicts, this document governs.

## The law: one family = one role. Roles never overlap.

| Family | Role (the ONLY role) | Anchors | Never |
|---|---|---|---|
| **COBALT** | Brand spine / structural chrome — app background, surfaces, platform framework | `#1C3B68` | interaction, signature, status |
| **GOLD** | Brand signature / peak moments only | dark `#C5A059` · light `#AC8847` | interactive controls, status |
| **AZURE** | Interactive / every clickable affordance — links, buttons, hover, active, selection, focus | `#0EA5E9` | structural chrome, signature, status |
| **SLATE** | Neutrals — text hierarchy, borders, dividers, neutral UI | text `#0B0B0C` / `#334155` / `#64748B`; border `#E2E5EA` / `#CBD2DA`; divider `#D8DCE0`; neutral `#94A3B8` | brand accent |
| **SEMANTIC** | Status only — success, warning, danger, info, operational states | success `#16A34A` · warning `#D97706` · danger `#DC2626` · info `#2563EB` | branding, interaction, structural UI |

### Critical rules
- Do **not** make Gold interactive.
- Do **not** use Azure as structural chrome.
- Do **not** use Semantic as branding.
- Do **not** use Slate as a brand accent.
- **Info-semantic** `#2563EB` (indigo) is deliberately distinct from **Azure-interactive** `#0EA5E9` (sky), so status never reads as a control.
- **Warning-semantic** `#D97706` (amber) is deliberately distinct from **Gold-signature** `#C5A059` (matte gold).
- **Online/quality-good** reuse the success hue and **maintenance** reuses the warning hue **only inside operational status UI** — never as branding.

## Token map (canonical D18 names)

**Cobalt (spine):** `--gx-cobalt` `#1C3B68` · `--gx-bg` `#1C3B68` · `--gx-bg-subtle` `#16314F` · `--gx-surface` `#FFFFFF` · `--gx-surface-2` `#F4F5F7`
**Gold (signature):** `--gx-gold` `#C5A059` · `--gx-gold-light` `#AC8847` · `--gx-gold-soft` `#EFE3C7`
**Azure (interactive):** `--gx-interactive` `#0EA5E9` · `--gx-interactive-hover` `#0284C7` · `--gx-interactive-active` `#0369A1` · `--gx-interactive-soft` `#E0F2FE` · `--gx-link` · `--gx-selected` · `--gx-ring` (all `#0EA5E9`)
**Slate (neutrals):** `--gx-text-1` `#0B0B0C` · `--gx-text-2` `#334155` · `--gx-text-3` `#64748B` · `--gx-border` `#E2E5EA` · `--gx-border-strong` `#CBD2DA` · `--gx-divider` `#D8DCE0` · `--gx-neutral` `#94A3B8`
**Semantic (status):** `--gx-success` `#16A34A` · `--gx-warning` `#D97706` · `--gx-danger` `#DC2626` · `--gx-info` `#2563EB` · `--gx-online` `#16A34A` · `--gx-provisioned` `#0EA5E9` · `--gx-quality-good` `#16A34A` · `--gx-maintenance` `#D97706` · `--gx-on-color` `#FFFFFF`

Exports: `11-figma/tokens/` — `gaahex-tokens.css`, `.scss`, `.json`, `.js`, `.ts`, `GAAhexTokens.swift`, `gaahex_colors.xml`. Pre-D18 names (`--gx-color-cobalt`, `cobalt-lift`, `ink`, `cloud`, `silver`, …) are retained **only as deprecated aliases** for backward compatibility.

## Migration from the pre-D18 palette (superseded)

| Pre-D18 (deprecated) | D18 replacement | Note |
|---|---|---|
| `cobalt` | `--gx-cobalt` / `--gx-bg` | spine |
| `cobalt-lift` (also used for links) | `--gx-cobalt` dark tint **+** new `--gx-interactive` (Azure) | **key change:** interaction is now Azure, not cobalt-lift |
| `gold` | `--gx-gold` (+ `--gx-gold-light` for light bg) | signature only |
| `ink` / `cloud` / `border` / `silver` | `--gx-text-1` / `--gx-surface-2` / `--gx-border` / `--gx-divider` | neutrals |
| _(none)_ | `--gx-success/warning/danger/info` + operational | new status family |

## Accessibility
- Body text: `--gx-text-1`/`--gx-text-2` on `--gx-surface`/`--gx-surface-2` meet WCAG AA.
- Links/affordances: use `--gx-interactive-hover` `#0284C7` for text-weight links on light to clear AA; `--gx-interactive` for larger affordances and focus rings (`--gx-ring`).
- On the cobalt spine (`--gx-bg`), use white/`--gx-surface-2` text and chrome.
- Gold is emphasis, not body text; never gold text on light without the cobalt anchor.
- Status must carry a non-color cue (icon/label) in addition to the semantic color.

## Logo & D18
The brand logo uses **Cobalt (spine) + Gold (signature)** and is **unchanged**. Azure/Slate/Semantic are **system** colors, not logo recolors. Optional, geometry-identical UI-glyph treatments are documented in `D18_Logo_Evolution_Review.md` and live in `01-logo/_d18-candidates/`; they are **not** canonical brand logos.
