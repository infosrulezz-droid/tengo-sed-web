# Tengo-Sed.cl — Project Context for New Chat

## How to start
```
cd "C:\Users\LAPMAC CHILE\Desktop\tengo-sed-FINAL"
node server.js
```
Then open:
- **Storefront** : http://localhost:8000/
- **Admin store** : http://localhost:8000/store.html?admin=tengosed2024
- **Old catalog** : http://localhost:8000/catalog.html?admin=tengosed2024
- **PDF print**   : http://localhost:8000/catalog-print

**Shortcut:** Double-click `INICIAR-TENGO-SED.bat` on the Desktop.

---

## CURRENT STATUS (as of 2026-06-23) ✅ ALL WORKING

### Products
- **221 products** total, all valid prices
- **177 products** have images (44 show emoji placeholder — normal)
- **0 broken image references**
- Categories: promos(5), cerveza(59), vino(36), whisky(14), ron(14), pisco(13), fernet(11), confites(5), tequila(4), gin(3), otro(3), vodka(2), bebidas(52)

### Features Status
| Feature | Status |
|---------|--------|
| Product catalog (all 221) | ✅ Working |
| Category filter + search | ✅ Working |
| Cart → WhatsApp ordering | ✅ Working |
| Hero carousel (5 slides) | ✅ Working |
| Admin product edit/delete | ✅ Working |
| Admin hero slide upload + Stamp | ✅ Working |
| CEO agent (scan every 45s) | ✅ Working |
| PDF catalog print | ✅ Working |
| Add product (catalog.html) | ✅ Working |
| Session state persistence | ✅ Working |
| Stamp Agent (standalone) | ✅ Working — stamp-standalone.html |

### MINSAL Aviso
- Hero upload stamp now uses **official MINSAL design**: black background, "ADVERTENCIA" header, body text, "MINISTERIO DE SALUD" footer, red+blue flag strip
- Logo is now **transparent watermark** (0.55 opacity, no white pill)
- Same design in `stamp-standalone.html` artifact

---

## STORE.HTML — Phases completed ✅

### Phase 1 — Foundation ✅
- Liquid glass design system (CSS vars, blur effects, keyframes)
- Sticky navbar (logo fallback to brand text, search, cart badge, category nav)
- Announce bar with hours and WhatsApp number
- Scroll reveal observer for all `.reveal` elements
- Loading screen with animated progress bar
- Toast notifications
- Footer (3 columns: locations, hours, contact)

### Phase 2 — Hero Carousel ✅
- 5 slides with gradient backgrounds + floating orbs
- Glass overlay product preview cards (real product data + prices)
- Auto-play (10s), touch swipe, keyboard arrows
- Slide counter badge ("1 / 5")
- ADMIN: "📸 Cambiar foto" → stamps with MINSAL official aviso + transparent logo
- ADMIN: "✏️ Editar texto" → makes hero text directly contentEditable

### Phase 3 — Product Admin Editing ✅
- Click ✏️ on any product card in admin mode → opens modal
- Modal: edit name, price, change image, toggle agotado, delete product
- Saves to server via POST /api/save

### Phase 4 — CEO Agent ✅
- Shows in admin mode (bottom right corner)
- Scans every 45s: product count, agotado, broken images, server health
- Receives notes from admin and saves to notes.json

### Phase 5 — Final Polish ✅
- Mojibake heal on server startup
- Back-to-top ↑ button
- Root URL / → store.html
- Session state (filter/search/slide persist across refreshes)
- Canva editor: click any `.editable` in admin → floating toolbar

---

## Server routes (server.js)
- `GET /` → store.html
- `GET /store.html` → storefront
- `GET /catalog.html` → old admin catalog (add/edit/delete products)
- `GET /catalog-print` → PDF-ready HTML (base64 images embedded)
- `POST /api/save` → save products_inventory.json + imgMap + new images
- `POST /api/save-note` → save notes.json
- `POST /api/update-notes` → replace entire notes.json
- `POST /api/upload-logo` → replace logo.png
- `POST /api/upload-banner` → replace banner.png
- `POST /api/upload-hero-slide` → save hero_slides/slide_N.ext
- `POST /api/save-hero-config` → save hero_config.json
- `POST /api/chat` → Claude AI proxy (requires CLAUDE_API_KEY env var)

---

## File structure
```
tengo-sed-FINAL/
├── server.js                — Node.js HTTP server (port 8000)
├── store.html               — ✅ Customer storefront + admin
├── catalog.html             — Admin: add/edit/delete products
├── stamp-agent.html         — Stamp agent (server-based)
├── stamp-standalone.html    — ✅ Stamp agent (self-contained, no server needed)
├── products_inventory.json  — 221 products {name, price, cat, agotado}
├── product_img_map.json     — Product name → image filename (177 mapped)
├── hero_config.json         — Hero slide backgrounds
├── notes.json               — CEO notes log
├── products/                — Product images (~180 files)
├── hero_slides/             — slide_0.png, slide_2.png, slide_3.png, slide_4.png
├── logo.jpg / logo.png      — Store logo
└── CONTINUE_HERE.md         — This file
```

---

## Admin password / URLs
- Admin param: `?admin=tengosed2024`
- WhatsApp: +56 9 9238 0324

## Fixes applied (2026-06-23)
- Added `promos` category to CATS array (5 promo products now visible)
- Fixed `licores` → `otro` category (3 products now visible)
- Healed Mojibake keys in product_img_map.json (all keys now UTF-8 clean)
- Rebuilt imgMap with priority: custom uploads > replacements > originals
- Updated stampHeroImage to use official MINSAL Chile aviso design
- Made hero stamp logo transparent (0.55 opacity, no pill)
- Updated stamp-standalone.html with same official MINSAL aviso
- Created INICIAR-TENGO-SED.bat on Desktop for easy startup

## ✅ DEPLOY READY — CEO Scan 3/3 passed (2026-06-23 ~3am)
Hero: 5/5 slides with real promo images | 221 products | 177 images | 0 broken | cart works | WhatsApp OK

## Design upgrades applied (2026-06-23 night)
- **Hero carousel FIXED — images now match slides:**
  - Slide 1: slide_0.png (Corona+Budweiser FIFA) → "Cervezas Importadas" + "2×$11.000" gold badge
  - Slide 2: slide_3.png (Jack Apple+MrBig combo) → "Jack Apple + Mr Big" + "$26.990" gold badge
  - Slide 3: wine burgundy gradient → "Vinos & Espumantes" + vino preview cards
  - Slide 4: copper gradient → "El mejor Pisco" + pisco preview cards
  - Slide 5: slide_2.png (Jack Blackberry FIFA) → "Jack Blackberry"
- Promo image slides: dark left→right gradient overlay, no competing preview cards, green CTA
- Announce bar: FIFA 2026 tag + gold border + dark navy gradient
- Category pills: larger (84px), bigger emoji, stronger hover lift
- Product cards: wider (182px), taller image (175px), drop-shadow, bigger price (19px)
- Section headers: cyan→gold gradient underline accent bar
- Promo banners: radial gold glow, gradient green CTA button
- CEO scan (2026-06-23): ✅ ALL GREEN — 221 products, 177 images, 0 issues

## Final hero carousel (2026-06-23 ~3am) — ALL 5 REAL PROMO IMAGES
| Slide | File | Image | Price |
|-------|------|-------|-------|
| 1 | slide_0.png | Corona + Budweiser FIFA "2×11.000" | 2×$11.000 |
| 2 | slide_1.png | Corona + Sol "VOLVIÓ OFERTA" | 2×$10.000 |
| 3 | slide_3.png | Jack Apple + Mr Big "PACK MUNDIAL" | $26.990 |
| 4 | slide_2.png | Jack Blackberry FIFA 2026 750ml+1L | — |
| 5 | slide_4.png | Jack Honey + Jack Fire packs | $26.990 c/u |
- Overlay: bottom-up gradient (image shows fully, CTA anchored at bottom-left)
- CEO Scans #1 #2 #3: ALL ZERO ISSUES ✅
