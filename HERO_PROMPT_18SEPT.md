# Hero carousel — 6 category slides, Fiestas Patrias 2026

Replaces the Copa Mundial theme. Six slides → `hero_slides/slide_0.png` … `slide_5.png`.

| # | File | Category |
|---|---|---|
| 0 | `slide_0.png` | Cerveza — promoción |
| 1 | `slide_1.png` | Pisco |
| 2 | `slide_2.png` | Whisky |
| 3 | `slide_3.png` | Ron |
| 4 | `slide_4.png` | Vinos |
| 5 | `slide_5.png` | Mojitos y cócteles |

---

## 1. Technical spec — exact, not approximate

| Property | Value |
|---|---|
| Canvas | **1600 × 560 px** |
| Ratio | 20:7 (2.857:1) |
| Format | PNG (WebP conversion happens after) |
| Colour | sRGB |

The CSS uses `aspect-ratio:1600/560` with `object-fit:contain`. Off-ratio images
get black letterbox bars — so hit 1600×560 exactly, or generate at the same 20:7
ratio and downscale. **Never upscale.**

### Layout zones

```
y    0 ────────────────────────────────────────────────
     │ LEFT 40%  (x 0–640)        RIGHT 60% (x 640–1600)
     │ Keep CALM and DARKER.      Product hero shot.
     │ Headline + price + CTA     Bottles lit, labels
     │ are stamped here.          facing camera, sharp.
y  462 ──────────────────────────────────────────────── SAFE FLOOR
     │ MINSAL warning box — stamped afterwards
y  545 ────────────────────────────────────────────────
     │ flag bar (blue / white / red)
y  560 ────────────────────────────────────────────────
```

**Nothing important below y=462. Leave the bottom 100 px a plain dark band** —
`stamp_hero.ps1` draws the logo and the MINSAL warning over it.

**Do not ask the generator to render any text.** Image models mangle Spanish, and
the ADVERTENCIA wording is legally mandated in Chile. Text is stamped afterwards.

---

## 2. Master prompt — shared by all six

> Wide cinematic banner, 1600×560 pixels, ultra-wide 20:7 aspect ratio, premium
> product advertising photography for a Chilean liquor store during Fiestas
> Patrias (18 de septiembre).
>
> Setting: a warm night-time *fonda* / *ramada* — wooden posts, straw roof,
> strings of Chilean flag bunting in blue, white and red crossing the upper
> frame, warm golden string lights, soft bokeh, faint Andes cordillera on the
> horizon, confetti in the national colours.
>
> Composition: the LEFT 40% of the frame stays dark, calm and uncluttered — no
> objects, no faces, no detail there. The RIGHT 60% holds the product, sharply
> lit and centred, labels facing camera.
>
> Lighting: warm amber key from the upper right, deep shadows, high contrast,
> glossy highlights on glass.
>
> Bottom 100 pixels: plain dark band, no detail.
>
> Style: photoreal, rich saturated colour, festive but premium. 4K detail.
>
> No text, no lettering, no words, no logos, no watermarks.

---

## 3. The six product lines

Paste the master prompt, then swap this paragraph in.

**slide_0 — CERVEZA (promoción)**
> Product: ice-cold beer bottles and cans in a galvanised tub overflowing with
> ice, condensation beading on the glass, a six-pack carton beside it, water
> droplets frozen mid-splash.

**slide_1 — PISCO**
> Product: a clear bottle of Chilean pisco beside a tall highball of piscola with
> ice and cola, plus a frothy pisco sour in a coupe glass with a lime wheel,
> lime halves and ice scattered on the wood.

**slide_2 — WHISKY**
> Product: an amber whisky bottle beside a heavy crystal tumbler holding a large
> clear ice sphere, warm amber liquid catching the light, subtle smoke haze in
> the background.

**slide_3 — RON**
> Product: a dark rum bottle with a cane-sugar and tropical feel — sugar cane
> stalks, a cut lime, and a rocks glass of rum over ice on rustic wood.

**slide_4 — VINOS**
> Product: a bottle of Chilean red wine with two filled wine glasses, dark
> grapes and vine leaves on the table, deep ruby tones catching warm backlight.

**slide_5 — MOJITOS Y CÓCTELES**
> Product: a tall mojito in a highball glass — crushed ice, fresh mint sprigs,
> lime wedges, condensation — beside a colourful terremoto (pale yellow wine
> with pineapple ice cream) and a shaker, mint and citrus scattered around.

---

## 4. Negative prompt — use on every slide

> text, words, letters, typography, watermark, logo, signature, distorted bottle
> labels, deformed hands, people's faces, blurry product, low resolution, flat
> vector art, cartoon, clipart, cluttered left side, busy detail on the left
> third, sombrero, mariachi, Cinco de Mayo, tacos, Mexican flag, Peruvian flag,
> world cup, football, soccer ball, stadium, trophy

**Why those exclusions specifically:**
- `sombrero / mariachi / Cinco de Mayo / Mexican flag` — image models routinely
  render Mexican independence when asked for Latin American patriotic imagery.
  This is the single most common failure for this brief.
- `world cup / football / trophy` — the previous slide set was Copa Mundial and
  models drift back toward it.
- `Peruvian flag` — pisco is claimed by both Chile and Peru; without this you get
  Peruvian branding on a Chilean pisco slide.

---

## 5. After you generate

1. Save the 6 files to `Downloads/`.
2. Edit the `$sources` block at the top of `stamp_hero.ps1` — point each entry at
   your new filename, set `out` to `slide_0.png` … `slide_5.png`, and update each
   `lbl` to the category name.
3. Run `stamp_hero.ps1` — it applies the logo and MINSAL bar.
4. Tell Claude. Code changes still needed on this side:
   - `totalSlides` in `index.html` is currently **5** and must become **6**
   - a sixth `.slide` block must be added to the carousel markup
   - WebP conversion for all six
   - alt text per slide

---

## 6. Fix these flaws from the current set

1. `slide_0` — headline "VOLVIO LA OFERTA" is clipped by the product panel
   overlapping it. Cause: artwork intruding into the left text zone.
2. `slide_2`, `slide_3`, `slide_4` — the Gato wine bottle has an **un-removed
   white rectangle** behind it instead of a clean cutout.
3. Those same three reuse an identical right-side collage, so half the carousel
   looks the same. The six product lines above are deliberately distinct.

---

## 7. Chilean alcohol-advertising constraints

- MINSAL warning is mandatory and is stamped into the bottom band. Never crop it.
- No minors, and nobody who reads as under 25, anywhere in the imagery.
- No driving, no workplaces, no depiction of excessive drinking.
- The 18+ badge sits in the bottom band — keep that area clear.
