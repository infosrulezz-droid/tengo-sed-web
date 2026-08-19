# Hero carousel — Fiestas Patrias 2026 (18 de septiembre)

Replaces the Copa Mundial theme. Five slides, `hero_slides/slide_0.png` … `slide_4.png`.

---

## 1. Technical spec (non-negotiable)

| Property | Value |
|---|---|
| Canvas | **1600 × 560 px** |
| Ratio | 20:7 (2.857:1) |
| Format | PNG (I convert to WebP — 88% smaller, verified lossless to the eye) |
| Colour | sRGB |

**Layout zones**, measured from your current slides:

```
y    0 ─────────────────────────────────────────────  ← top
     │  LEFT COLUMN (x 80–700)      RIGHT (x 700–1600)
     │  • eyebrow "TENGO SED IQUIQUE"                 │
     │  • headline (big)             product collage  │
     │  • one-line subtitle          / hero bottle    │
     │  • price                                       │
     │  • green WhatsApp button                       │
y  462 ─────────────────────────────────────────────  ← SAFE-ZONE FLOOR
     │  MINSAL warning box — 18+ · ADVERTENCIA text   │
y  545 ─────────────────────────────────────────────
     │  flag bar (blue / white / red)                 │
y  560 ─────────────────────────────────────────────  ← bottom
```

**Nothing important below y=462.** The site uses `object-fit: contain`, so the full
canvas always shows and nothing is cropped — but only at exactly 1600×560.

**Leave the bottom 100 px as a plain dark band.** `stamp_hero.ps1` draws the logo
(top-left) and the MINSAL warning bar over it afterwards. Do not ask the generator
to render the ADVERTENCIA text — image models mangle Spanish legal text, and that
text is legally required to be exact.

---

## 2. Master prompt

> Wide cinematic banner, 1600×560 pixels, ultra-wide 20:7 aspect ratio, for a
> Chilean liquor delivery store during Fiestas Patrias (18 de septiembre).
>
> Scene: a warm night-time *fonda* / *ramada* — wooden posts, straw roof, strings
> of Chilean flag bunting (blue, white, red) crossing the top of the frame, warm
> golden string lights, soft bokeh. Faint Andes cordillera silhouette on the
> horizon. Confetti and paper streamers in the national colours.
>
> Composition: the LEFT 40% must stay visually calm and darker — a clean area for
> text overlay, no busy detail, no faces, no objects. The RIGHT 60% holds the
> product hero shot, dramatically lit, sharp, product labels facing camera.
>
> Lighting: warm amber key light from the upper right, deep shadows, high contrast,
> premium advertising photography, glossy highlights on glass bottles.
>
> Bottom 100 pixels: a plain dark band, no detail, reserved for a legal notice.
>
> Style: photoreal product advertising, rich saturated colour, festive but
> premium — not cartoonish, not flat vector. 4K detail, sharp focus.
>
> No text, no lettering, no words, no logos, no watermarks.

---

## 3. The five slides

Swap the **product line** into the master prompt. Keep everything else identical
so the set feels like one campaign.

**slide_0 — Pack Dieciochero**
> Product: a bottle of Chilean pisco, a bottle of red wine, and a cold beer
> six-pack arranged together on a rustic wooden table with empanadas and a
> Chilean flag folded beside them.

**slide_1 — Terremoto**
> Product: a tall glass of *terremoto* — pale yellow pipeño wine with a scoop of
> pineapple ice cream on top and a straw — condensation on the glass, with a
> pipeño bottle behind it.

**slide_2 — Piscola**
> Product: a bottle of Chilean pisco beside a tall highball glass of piscola with
> ice and cola, lime wedge, ice cubes scattered, splash frozen mid-air.

**slide_3 — Asado y Cerveza**
> Product: ice-cold beer bottles and cans in a tub of ice, grill embers glowing
> warm orange behind, anticuchos on a grill out of focus in the background.

**slide_4 — Vino y Chicha**
> Product: a bottle of Chilean red wine and a clay jug of chicha on a wooden
> table, copihue flowers (red bell-shaped, Chile's national flower) at the edge,
> harvest grapes.

---

## 4. Negative prompt

> text, words, letters, typography, watermark, logo, signature, distorted bottle
> labels, extra limbs, deformed hands, people's faces, blurry product, low
> resolution, flat vector art, cartoon, clipart, cluttered left side, busy
> background on left third, Mexican sombrero, mariachi, Cinco de Mayo, tacos,
> Peruvian flag, world cup, football, soccer ball, stadium

**On that last group:** the previous set was Copa Mundial, so explicitly excluding
football imagery stops the model drifting back. And Chilean Fiestas Patrias is
routinely confused with Mexican independence by image models — excluding sombrero,
mariachi and Cinco de Mayo is what prevents that.

---

## 5. Workflow

1. Generate 5 images at 1600×560 (or generate larger at the same 20:7 ratio and
   downscale — never upscale).
2. Save into `Downloads/`.
3. Update the `$sources` list at the top of `stamp_hero.ps1` to point at the new
   filenames, and change each `lbl` to the new slide names above.
4. Run `stamp_hero.ps1` — it writes `hero_slides/slide_0..4.png` with the logo and
   MINSAL bar applied.
5. Tell me, and I'll run the WebP conversion and update `<picture>` sources.

---

## 6. Fix while regenerating

Three flaws are baked into the *current* slides:

1. `slide_0` — the headline "VOLVIO LA OFERTA" is clipped by the collage panel.
   Cause: text placed too far right, into the collage zone. Keep headlines inside
   x < 700.
2. `slide_2`, `slide_3`, `slide_4` — the Gato wine bottle has an **un-removed
   white rectangle** behind it. That cutout needs a transparent background.
3. Those same three reuse an identical right-side collage, so 3 of 5 slides look
   the same. Give each slide its own product shot — the five above are
   deliberately distinct.

---

## 7. Alcohol-advertising notes (Chile)

- The MINSAL warning is mandatory; `stamp_hero.ps1` applies it. Never crop it.
- No minors, and no one who reads as under 25, in the imagery.
- Don't depict driving, workplaces, or excessive consumption.
- Keep the 18+ badge legible — it sits in the bottom band.
