# Deploy blockers — Tengo Sed

Audited 2026-08-18 against `server.js`. Each item below was **tested against the
running server**, not inferred from reading code.

---

## BLOCKER 1 — Every write endpoint is unauthenticated

There is no auth check anywhere in `server.js`. These all accept a plain POST
from anyone on the internet:

| Endpoint | What an attacker gets |
|---|---|
| `/api/save` | Overwrites `products_inventory.json` — **every price, every product** |
| `/api/upload-logo` | Replaces your logo |
| `/api/upload-banner` | Replaces your banner |
| `/api/upload-hero-slide` | Replaces hero slides with any image |
| `/api/save-hero-config` | Rewrites the carousel |
| `/api/save-page-edits` | Rewrites text on the storefront |
| `/api/save-note` / `/api/update-notes` | Writes/erases your CEO notes |

**Proof:** an unauthenticated `POST /api/save-note` returned `{"ok":true}`.
No header, no cookie, no token.

Someone could set every product to $1, or replace your hero with anything they
like. On `localhost` this is harmless. On a public domain it is not.

## BLOCKER 2 — `?admin=1` grants admin with no password

`index.html` enables admin mode from a URL parameter alone:

```js
if(p.get('admin')==='1' || p.get('admin')==='true'){ ... }
```

`store.html` at least checks a password (`?admin=tengosed2024`), though that
password ships in client-side JavaScript. `index.html` checks nothing.

## BLOCKER 3 — Source code is publicly downloadable

`GET /server.js` returns **200, 24,829 bytes**. The static handler serves any
file inside the project root, so `products_inventory.json`, `notes.json`,
`page_edits.json` and `package.json` are all fetchable too.

Traversal *out* of the root is blocked (`/../package.json` → 404), but
traversal *within* it is not: `GET /products/../server.js` → **200**.

If a `.env` is ever placed in the project root, it would be served over HTTP.
Today the key is read from `../catalog-agent/.env`, outside the root — keep it
that way.

## BLOCKER 4 — `/api/chat` is unmetered and spends real money

`/api/chat` proxies to the Claude API using your key, with no rate limit and no
auth. Anyone who finds the endpoint can run your API bill up. The endpoint also
accepts a caller-supplied `context` that is concatenated into the system prompt,
and the model's replies carry `[ACTION:editPrice:…]` commands the page executes —
so prompt injection has a path to real price changes.

## BLOCKER 5 — 50 MB unauthenticated uploads

`MAX_BODY = 50 * 1024 * 1024` with no auth on the upload routes. Repeated posts
fill the disk.

---

## Minimum fix before going public

1. One shared secret in `.env` (kept **outside** the web root), required by every
   `/api/*` write route; reject with 401 otherwise.
2. `index.html` must check that secret instead of `?admin=1`.
3. Deny static serving of `*.json`, `*.js`, `*.ps1`, `*.md` at the server root —
   allow only `products/`, `hero_slides/`, and the HTML pages.
4. Normalise and confine `filePath`, then verify it still starts with `ROOT`.
5. Basic rate limit on `/api/chat` (per-IP, per-minute).
6. Drop `MAX_BODY` to ~8 MB and restrict uploads to image MIME types.

## Note on hosting

The site is plain Node with no framework. Static hosts (GitHub Pages, Netlify
static, Vercel static) will serve the HTML but **not** run `server.js`, so the
save/upload/chat APIs would simply 404 — which incidentally closes items 1, 4
and 5. If you only need the storefront and WhatsApp ordering, static hosting is
both simpler and much safer. You would lose live admin editing.
