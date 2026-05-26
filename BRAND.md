# GAAex — Brand & Design Tokens

The single source of truth for GAAex's visual identity. GAAex is **dark-first** (a deep obsidian
environment that makes the Cobalt + Gold identity pop) but **ships both themes** — dark is the
default (`:root`), light is a `[data-theme="light"]` override, toggled in the header. The brand
marks (Cobalt + Gold) and the functional signals carry across both themes; only the neutrals change.
The `frontend` design-token pass must use **exactly** these values (as CSS custom properties) — do
not guess or introduce off-palette colors, and never hardcode a theme's hex in a component.

The logo carries the identity: **"GA" in Deep Cobalt, "ex" in Matte Gold** (already baked into
`public/full-dark.png` / `icon-light.png`, which sit on the dark background).

---

## 1. The Master Palette (raw)

### Brand core
| Name | Hex | Role |
|------|-----|------|
| Deep Cobalt Blue | `#1C3B68` | Primary brand element — logo "GA", structural UI, headers, high-importance type. Institutional stability, precision, reliability. |
| Matte Gold | `#C5A059` | Core accent / signature — logo "ex", performance highlights, precision metrics, critical focus states. Premium, verified quality, elite tiering. |

### Infrastructure & interface neutrals — DARK
| Name | Hex | Role |
|------|-----|------|
| Deep Obsidian | `#0D0F12` | Absolute background — dashboards, app backdrops. Makes Cobalt/Gold pop without glare. |
| Stealth Charcoal | `#1F242C` | Component neutral — secondary containers, table headers, card backgrounds, structural borders. |
| Ice White | `#F4F6F9` | Primary typography / readability — cool-undertoned white for data legibility on dark. |

### Infrastructure & interface neutrals — LIGHT
Brand marks keep their exact identities; their visual weight increases on a bright canvas. Clean,
sterile layers separate data blocks without colorful tint bias.
| Name | Hex | Role |
|------|-----|------|
| Alabaster Canvas | `#F8F9FA` | Absolute background — crisp off-white, no monitor glare. |
| Elevated White | `#FFFFFF` | Card / container background — widgets, tables, content blocks; with a subtle shadow on Alabaster = structural depth. |
| Platinum Border | `#E2E8F0` | Component borders & gridlines — subtle, clean separation. |
| Ink Obsidian | `#111827` | Primary typography — near-black charcoal, maximum accessibility/sharpness. |

### Operational performance signals — DARK
| Name | Hex | Role |
|------|-----|------|
| Electric Crimson | `#E63946` | Critical / destructive — failures, critical churn, destructive states. |
| Amber Flare | `#F5A623` | Warning — pending actions, optimization warnings, bottlenecks. |
| Neon Mint | `#2ECC71` | Optimal / target reached — compliance, healthy pipelines, stable status. |

### Operational performance signals — LIGHT
Slightly deepened so they stay legible on a bright background without eye strain.
| Name | Hex | Role |
|------|-----|------|
| Crimson Anchor | `#D90429` | Critical / destructive — deepened red for sharp text + error states. |
| Ochre Flare | `#E65F00` | Warning — richer, darker orange for high contrast. |
| Forest Mint | `#10B981` | Optimal / target reached — crisp professional green. |

---

## 2. Semantic tokens (use THESE in CSS)

Dark is the default theme (`:root`). Cobalt `#1C3B68` is intentionally deep — for interactive
elements on the obsidian background it needs a **brightened** tint so buttons/links stay legible and
accessible; those brightened/derived steps are marked *(derived)* and may be tuned for contrast, but
the source hues above are fixed.

```css
:root {
  /* Surfaces (dark-first) */
  --bg:           #0D0F12;   /* Deep Obsidian — app background            */
  --surface:      #1F242C;   /* Stealth Charcoal — cards, table headers   */
  --surface-2:    #262D37;   /* (derived) raised/hover surface            */
  --border:       #2A313B;   /* (derived) hairline structural border      */
  --border-soft:  rgba(244,246,249,0.08);  /* (derived) faint divider     */

  /* Text */
  --text:         #F4F6F9;   /* Ice White — primary                       */
  --text-2:       #AEB7C2;   /* (derived) secondary                       */
  --text-3:       #7C8794;   /* (derived) labels / helpers / muted        */
  --text-inv:     #0D0F12;   /* (derived) text on a solid gold/light fill */

  /* Brand */
  --brand:        #1C3B68;   /* Deep Cobalt — structural brand, headers   */
  --primary:      #3A6FB5;   /* (derived) brightened cobalt for buttons/links on dark */
  --primary-hover:#4A82CC;   /* (derived)                                 */
  --primary-soft: rgba(58,111,181,0.16);   /* (derived) tint background   */

  --accent:       #C5A059;   /* Matte Gold — accent, highlights, key metrics */
  --accent-hover: #D4B26C;   /* (derived) slightly lighter gold            */
  --accent-soft:  rgba(197,160,89,0.16);    /* (derived) gold tint        */
  --accent-text:  #0D0F12;   /* text/icon sitting on a solid gold fill    */

  /* Functional signals */
  --success:      #2ECC71;   --success-soft: rgba(46,204,113,0.16);
  --warning:      #F5A623;   --warning-soft: rgba(245,166,35,0.16);
  --danger:       #E63946;   --danger-soft:  rgba(230,57,70,0.16);

  /* Focus — gold, the signature focus state */
  --focus-ring:   rgba(197,160,89,0.55);
}

/* LIGHT theme — override only the neutrals; brand + signals keep their hues (deepened for contrast).
   On a light canvas Deep Cobalt is already high-contrast, so --primary is the cobalt itself (no
   brightening); gold darkens slightly so it doesn't wash out. */
[data-theme="light"] {
  /* Surfaces */
  --bg:           #F8F9FA;   /* Alabaster Canvas                          */
  --surface:      #FFFFFF;   /* Elevated White — cards (use a soft shadow)*/
  --surface-2:    #F1F3F5;   /* (derived) raised/hover surface            */
  --border:       #E2E8F0;   /* Platinum Border                           */
  --border-soft:  rgba(17,24,39,0.06);     /* (derived) faint divider     */

  /* Text */
  --text:         #111827;   /* Ink Obsidian — primary                    */
  --text-2:       #4B5563;   /* (derived) secondary                       */
  --text-3:       #6B7280;   /* (derived) labels / helpers / muted        */
  --text-inv:     #FFFFFF;   /* (derived) text on a solid cobalt fill     */

  /* Brand */
  --brand:        #1C3B68;   /* Deep Cobalt                               */
  --primary:      #1C3B68;   /* cobalt is high-contrast on light — use it directly */
  --primary-hover:#16314F;   /* (derived) darker cobalt                   */
  --primary-soft: rgba(28,59,104,0.10);    /* (derived) tint background   */

  --accent:       #C5A059;   /* Matte Gold                                */
  --accent-hover: #B68F47;   /* (derived) darker gold for light           */
  --accent-soft:  rgba(197,160,89,0.14);   /* (derived) gold tint         */
  --accent-text:  #111827;   /* dark text/icon on a solid gold fill       */

  /* Functional signals — deepened light variants */
  --success:      #10B981;   --success-soft: rgba(16,185,129,0.12);  /* Forest Mint   */
  --warning:      #E65F00;   --warning-soft: rgba(230,95,0,0.12);    /* Ochre Flare   */
  --danger:       #D90429;   --danger-soft:  rgba(217,4,41,0.10);    /* Crimson Anchor*/

  /* Focus — cobalt on light (more visible than gold against a bright canvas) */
  --focus-ring:   rgba(28,59,104,0.45);
}
```

---

## 3. Allocation rules (where to use what)
- **App background:** `--bg` (Deep Obsidian) everywhere; never pure black, never light.
- **Cards / table headers / containers / borders:** `--surface` (Stealth Charcoal) + `--border`.
- **Primary text & data:** `--text` (Ice White); secondary/labels → `--text-2` / `--text-3`.
- **Primary actions (buttons, active nav, links):** `--primary` (brightened cobalt). Structural
  headers / brand blocks may use `--brand` (deep cobalt).
- **Accent — gold — is precious:** reserve `--accent` for high-priority metrics/KPIs, the active/
  selected emphasis, focus rings, and signature highlights. Don't flood the UI with gold.
- **Status pills / telemetry:** crimson = danger, amber = warning, mint = success (+ their `-soft`
  tints for pill backgrounds).
- **Sidebar:** already dark by design — keep it on `--bg`/`--surface` with the `icon-light.png` mark.
