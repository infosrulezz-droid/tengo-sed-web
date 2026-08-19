// server.js — Tengo-Sed catalog server with save API
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT     = process.env.PORT || 8000;
const ROOT     = __dirname;
const MAX_BODY = 50 * 1024 * 1024; // 50 MB limit (handles large images)

// ── Load Claude API key — env var in production, .env file locally ────────
let CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
if (!CLAUDE_API_KEY) {
  try {
    const envPath = path.join(ROOT, '..', 'catalog-agent', '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/CLAUDE_API_KEY=(.+)/);
    if (match) { CLAUDE_API_KEY = match[1].trim(); }
  } catch(e) { /* no local .env, that's fine in production */ }
}
console.log(CLAUDE_API_KEY ? '[CHAT] Claude API key loaded ✓' : '[CHAT] No API key — chat disabled');

const CHAT_BASE = `Eres el asistente IA EMBEBIDO en el catálogo de Tengo Sed, una tienda de licores y bebidas con delivery en Iquique, Chile.

TIENDA:
- Sucursales: Tengo Sed (Genaro Gallo 2836A) | Los Negros (Genaro Gallo 2243) | Red & White (18 de Sept 1578)
- Horarios: Dom–Jue 12pm–1am | Vie–Sáb 12pm–3am
- WhatsApp: +56 9 9238 0324 | Delivery solo IQQ | Web: tengo-sed.cl

Puedes ver el catálogo completo y hacer cambios REALES en la página. Para actuar, añade comandos al FINAL de tu respuesta con este formato exacto:

ACCIONES DISPONIBLES:
[ACTION:filterCategory:CATEGORIA] — filtra por: all, bebidas, cerveza, vino, pisco, ron, whisky, vodka, gin, tequila, fernet, confites, otro
[ACTION:setSearch:TEXTO] — busca productos por nombre
[ACTION:scrollTo:NOMBRE_PRODUCTO] — hace scroll al producto en pantalla
[ACTION:editPrice:NOMBRE_PRODUCTO:NUEVO_PRECIO] — cambia precio (solo número)
[ACTION:markAgotado:NOMBRE_PRODUCTO:true] — marca como agotado
[ACTION:markAgotado:NOMBRE_PRODUCTO:false] — marca como disponible
[ACTION:addDescription:NOMBRE_PRODUCTO:DESCRIPCION] — añade descripción

REGLAS:
- Responde SIEMPRE en español, breve y amable
- Puedes encadenar múltiples acciones en una respuesta
- Cuando hagas cambios, confirma brevemente lo que hiciste
- Para pedidos, dirige al WhatsApp
- Si el usuario pregunta por productos, usa el contexto del catálogo que recibes
- No repitas los [ACTION:...] en el texto visible, van al final`;

function buildSystemPrompt(context) {
  if (!context) return CHAT_BASE;
  var sys = CHAT_BASE;
  sys += '\n\nESTADO ACTUAL DEL CATÁLOGO:\n';
  sys += '- Categoría activa: ' + (context.activeCategory || 'all') + '\n';
  sys += '- Búsqueda activa: "' + (context.searchQuery || '') + '"\n';
  sys += '- Productos visibles: ' + (context.visibleCount || 0) + ' de ' + (context.totalProducts || 0) + ' totales\n';
  if (context.products && context.products.length) {
    sys += '\nLISTA COMPLETA DE PRODUCTOS (' + context.products.length + '):\n';
    context.products.forEach(function(p) {
      sys += '• ' + p.name + ' | $' + p.price + ' | ' + p.cat;
      if (p.agotado) sys += ' | AGOTADO';
      if (p.desc) sys += ' | desc: ' + p.desc;
      sys += '\n';
    });
  }
  return sys;
}

// ── Call Claude API (server-side, key never exposed to browser) ───────────
function callClaude(messages, system) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: system || CHAT_BASE,
      messages
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Bad response: ' + data.slice(0,200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Keep server alive — log unhandled errors instead of crashing ─────────
process.on('uncaughtException',  e => console.error('[UNCAUGHT]', e.message));
process.on('unhandledRejection', e => console.error('[UNHANDLED]', e));

// ── Fix Mojibake: re-encode double-encoded strings (Latin-1 read as UTF-8)
function fixMojibake(str) {
  try {
    const fixed = Buffer.from(str, 'latin1').toString('utf8');
    return fixed.includes('�') ? str : fixed;
  } catch(e) { return str; }
}

// ── Normalize key for fuzzy matching (lowercase, no accents, no punctuation)
function normKey(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}

// ── Heal imgMap: re-key using canonical product names ────────────────────
function healImgMap(rawMap, products) {
  const normToName = {};
  products.forEach(p => { normToName[normKey(p.name)] = p.name; });
  const healed = {};
  Object.keys(rawMap).forEach(k => {
    const fixed     = fixMojibake(k);
    const canonical = normToName[normKey(fixed)] || normToName[normKey(k)] || k;
    if (healed[canonical] == null) healed[canonical] = rawMap[k];
  });
  return healed;
}

// ── Heal product names on startup (fix Mojibake in products_inventory.json)
(function healProductsOnStartup() {
  try {
    const prodPath = path.join(ROOT, 'products_inventory.json');
    const raw      = fs.readFileSync(prodPath, 'utf8');
    const products = JSON.parse(raw);
    let changed    = false;
    products.forEach(p => {
      const fixed = fixMojibake(p.name);
      if (fixed !== p.name) { p.name = fixed; changed = true; }
    });
    if (changed) {
      fs.writeFileSync(prodPath, JSON.stringify(products, null, 2), 'utf8');
      console.log('[HEAL] Fixed Mojibake in product names and re-saved products_inventory.json');
    } else {
      console.log('[HEAL] Product names look clean — no Mojibake detected');
    }
  } catch(e) {
    console.error('[HEAL] Could not heal product names:', e.message);
  }
})();

// ── MIME types ───────────────────────────────────────────────────────────
function mime(ext) {
  const m = {
    '.html':'text/html', '.css':'text/css', '.js':'application/javascript',
    '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
    '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif',
    '.avif':'image/avif', '.svg':'image/svg+xml', '.ico':'image/x-icon'
  };
  return m[ext] || 'application/octet-stream';
}

// ── Collect POST body safely into a Buffer ───────────────────────────────
function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('error', reject);
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        return reject(new Error(`Payload too large (max ${MAX_BODY / 1024 / 1024} MB)`));
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// ── HTTP server ──────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ── POST /api/save-note ─────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/save-note') {
    collectBody(req).then(raw => {
      const note = JSON.parse(raw);
      const notesPath = path.join(ROOT, 'notes.json');
      let notes = [];
      try { notes = JSON.parse(fs.readFileSync(notesPath, 'utf8')); } catch(e) {}
      notes.push(note);
      fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf8');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok: true, total: notes.length}));
    }).catch(e => {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok: false, error: e.message}));
    });
    return;
  }

  // ── POST /api/update-notes — replace entire notes.json ──────────
  if (req.method === 'POST' && req.url === '/api/update-notes') {
    collectBody(req).then(raw => {
      const notes = JSON.parse(raw);
      fs.writeFileSync(path.join(ROOT, 'notes.json'), JSON.stringify(notes, null, 2), 'utf8');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok: true}));
    }).catch(e => {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok: false, error: e.message}));
    });
    return;
  }

  // ── POST /api/save ───────────────────────────────────────────────
  // Persist admin click-bot page edits so they replay on refresh.
  if (req.method === 'POST' && req.url === '/api/save-page-edits') {
    collectBody(req).then(raw => {
      const edits = JSON.parse(raw);
      const safeEdits = Array.isArray(edits) ? edits : [];
      fs.writeFileSync(path.join(ROOT, 'page_edits.json'), JSON.stringify(safeEdits, null, 2), 'utf8');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok: true, total: safeEdits.length}));
    }).catch(e => {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok: false, error: e.message}));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/save') {
    collectBody(req)
      .then(raw => {
        const data = JSON.parse(raw);

        const products = data.products
          || JSON.parse(fs.readFileSync(path.join(ROOT, 'products_inventory.json'), 'utf8'));

        // 1. Save products inventory
        if (data.products) {
          fs.writeFileSync(
            path.join(ROOT, 'products_inventory.json'),
            JSON.stringify(data.products, null, 2), 'utf8'
          );
        }

        // 2. Save image map (heal Mojibake keys before writing)
        if (data.imgMap) {
          const healed = healImgMap(data.imgMap, products);
          fs.writeFileSync(
            path.join(ROOT, 'product_img_map.json'),
            JSON.stringify(healed, null, 2), 'utf8'
          );
        }

        // 3. Save new base64 images to /products/ folder
        if (data.newImages && Object.keys(data.newImages).length > 0) {
          const mapPath = path.join(ROOT, 'product_img_map.json');
          const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

          Object.keys(data.newImages).forEach(name => {
            const raw64   = data.newImages[name];
            const cleanB64 = raw64.replace(/[\s]/g, ''); // strip any whitespace
            const match = cleanB64.match(/^data:image\/([a-zA-Z0-9+\-]+);base64,(.+)$/);
            if (!match) {
              console.error('[IMG] Unrecognised format for:', name, '| type prefix:', cleanB64.slice(0, 40));
              return;
            }
            const mimeType = match[1].toLowerCase();
            const ext = mimeType === 'jpeg' ? 'jpg'
                      : mimeType === 'svg+xml' ? 'svg'
                      : mimeType;
            const safeName = name.normalize('NFD')
              .replace(/[̀-ͯ]/g,'')
              .toLowerCase()
              .replace(/[^a-z0-9\s]/g,'')
              .replace(/\s+/g,'_')
              + '_custom.' + ext;

            const imgBuffer = Buffer.from(match[2], 'base64');
            if (imgBuffer.length === 0) {
              console.error('[IMG] Empty buffer for:', name);
              return;
            }

            fs.writeFileSync(path.join(ROOT, 'products', safeName), imgBuffer);
            map[name] = safeName;
            console.log(`[IMG] Saved: ${safeName}  (${(imgBuffer.length/1024).toFixed(1)} KB)  product: ${name}`);
          });

          fs.writeFileSync(mapPath, JSON.stringify(map, null, 2), 'utf8');
        }

        console.log('[SAVED]', new Date().toLocaleTimeString());
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok: true}));
      })
      .catch(e => {
        console.error('[SAVE ERROR]', e.message);
        if (!res.headersSent) {
          res.writeHead(500, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok: false, error: e.message}));
        }
      });
    return;
  }

  // ── POST /api/upload-logo — replace logo.png ────────────────────
  if (req.method === 'POST' && req.url === '/api/upload-logo') {
    collectBody(req)
      .then(raw => {
        const { imageData } = JSON.parse(raw);
        if (!imageData) throw new Error('No imageData');
        const base64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
        const buf = Buffer.from(base64, 'base64');
        fs.writeFileSync(path.join(ROOT, 'logo.png'), buf);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok: true}));
      })
      .catch(e => {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok: false, error: e.message}));
      });
    return;
  }

  // ── POST /api/upload-banner — replace banner.png ────────────────
  if (req.method === 'POST' && req.url === '/api/upload-banner') {
    collectBody(req)
      .then(raw => {
        const { imageData } = JSON.parse(raw);
        if (!imageData) throw new Error('No imageData');
        const base64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
        const buf = Buffer.from(base64, 'base64');
        fs.writeFileSync(path.join(ROOT, 'banner.png'), buf);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok: true}));
      })
      .catch(e => {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok: false, error: e.message}));
      });
    return;
  }

  // ── POST /api/upload-hero-slide — save hero bg image ───────────
  if (req.method === 'POST' && req.url === '/api/upload-hero-slide') {
    collectBody(req).then(raw => {
      const { slideIndex, imageData } = JSON.parse(raw);
      if (imageData == null) throw new Error('No imageData');
      const base64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
      const match  = imageData.match(/^data:image\/([a-zA-Z0-9+\-]+);base64,/);
      const ext    = match ? (match[1] === 'jpeg' ? 'jpg' : match[1].replace('+xml','')) : 'jpg';
      const dir    = path.join(ROOT, 'hero_slides');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      const filename = 'slide_' + slideIndex + '.' + ext;
      fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, 'base64'));
      console.log('[HERO] Slide', slideIndex, 'saved:', filename);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok: true, filename}));
    }).catch(e => {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok: false, error: e.message}));
    });
    return;
  }

  // ── POST /api/save-hero-config — save hero_config.json ──────────
  if (req.method === 'POST' && req.url === '/api/save-hero-config') {
    collectBody(req).then(raw => {
      const cfg = JSON.parse(raw);
      fs.writeFileSync(path.join(ROOT, 'hero_config.json'), JSON.stringify(cfg, null, 2), 'utf8');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok: true}));
    }).catch(e => {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok: false, error: e.message}));
    });
    return;
  }

  // ── GET /catalog-print  — server-rendered full catalog for PDF ───
  if (req.method === 'GET' && req.url === '/catalog-print') {
    try {
      const products = JSON.parse(fs.readFileSync(path.join(ROOT,'products_inventory.json'),'utf8'));
      const imgMap   = JSON.parse(fs.readFileSync(path.join(ROOT,'product_img_map.json'),'utf8'));
      const today    = new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit',year:'numeric'});
      const catLabels = {whisky:'Whisky',gin:'Gin',cerveza:'Cerveza',ron:'Ron',vino:'Vino',
        fernet:'Coctel',pisco:'Pisco',vodka:'Vodka',tequila:'Tequila',bebidas:'Bebidas',
        zero:'Sin Alcohol',confites:'Confites',otro:'Licores',licores:'Licores',promos:'Promos'};
      const catEmojis = {whisky:'🥃',gin:'🍸',cerveza:'🍺',ron:'🧊',vino:'🍷',
        fernet:'🫙',pisco:'🌵',vodka:'🫗',tequila:'🥂',bebidas:'🥤',
        zero:'0️⃣',confites:'🍟',otro:'🍾',licores:'🍾',promos:'🏷️'};

      // Embed image as base64 so headless Chrome doesn't need extra HTTP requests
      function getImgB64(name) {
        if (!imgMap[name]) return '';
        const file = imgMap[name].split('?')[0];
        const abs  = path.join(ROOT, 'products', file);
        if (!fs.existsSync(abs)) return '';
        try {
          const ext  = path.extname(file).toLowerCase().replace('.','');
          const mimeT = ext === 'jpg' ? 'jpeg' : ext;
          const b64  = fs.readFileSync(abs).toString('base64');
          return `data:image/${mimeT};base64,${b64}`;
        } catch(e) { return ''; }
      }

      const inStock = products.filter(p => !p.agotado);
      const cards   = inStock.map(p => {
        const imgSrc = getImgB64(p.name);
        const label  = catLabels[p.cat] || p.cat || '';
        const emoji  = catEmojis[p.cat] || '🍾';
        const imgTag = imgSrc
          ? `<img src="${imgSrc}" alt="${p.name.replace(/"/g,'&quot;')}" />`
          : `<span class="femoji">${emoji}</span>`;
        return `<div class="pcard">
          <div class="pimg">${imgTag}</div>
          <div class="pinfo">
            <span class="pcat">${label}</span>
            <span class="pname">${p.name}</span>
            <span class="pprice">$${p.price.toLocaleString('es-CL')}</span>
          </div></div>`;
      }).join('');

      const html = `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8">
<title>Tengo-Sed — Catálogo ${today}</title>
<style>
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap");
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,sans-serif;background:#fff;color:#1E293B;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover{text-align:center;padding:28px 0 20px;border-bottom:3px solid #25D366;margin-bottom:20px}
.cover h1{font-size:30px;font-weight:900;letter-spacing:-1px}
.c{color:#00BCD4}.o{color:#F97316}
.cover p{font-size:12px;color:#64748B;margin-top:5px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 12px 28px}
.pcard{border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}
.pimg{height:105px;display:flex;align-items:center;justify-content:center;background:#F8FAFC;padding:6px}
.pimg img{max-width:100%;max-height:100%;object-fit:contain}
.femoji{font-size:34px}
.pinfo{padding:7px 9px}
.pcat{display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.4px}
.pname{display:block;font-size:10.5px;font-weight:700;line-height:1.3;margin:2px 0 4px;min-height:28px}
.pprice{display:block;font-size:13px;font-weight:800;color:#0F172A}
.footer{text-align:center;font-size:10px;color:#94A3B8;padding:14px;border-top:1px solid #E2E8F0}
@media print{
  @page{size:A4;margin:10mm}
  .grid{gap:5px;padding:0}
}
</style></head><body>
<div class="cover">
  <h1>Tengo-<span class="c">Sed</span><span class="o">.cl</span></h1>
  <p>Catálogo Oficial · ${today} · ${inStock.length} productos disponibles</p>
  <p style="margin-top:4px;font-size:12px;font-weight:700;color:#25D366">📲 +56 9 9238 0324</p>
</div>
<div class="grid">${cards}</div>
<div class="footer">Tengo-Sed.cl &nbsp;·&nbsp; Generado el ${today}</div>
</body></html>`;

      res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
      res.end(html);
    } catch(e) {
      res.writeHead(500); res.end('Error: ' + e.message);
    }
    return;
  }

  // ── POST /api/chat — Claude assistant proxy ──────────────────────
  if (req.method === 'POST' && req.url === '/api/chat') {
    if (!CLAUDE_API_KEY) {
      res.writeHead(503, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:false, error:'Chat not configured'}));
    }
    collectBody(req)
      .then(raw => {
        const { messages, context } = JSON.parse(raw);
        if (!Array.isArray(messages) || messages.length === 0) throw new Error('No messages');
        const system = buildSystemPrompt(context);
        return callClaude(messages, system);
      })
      .then(data => {
        const reply = data.content && data.content[0] && data.content[0].text;
        if (!reply) throw new Error('Empty response from Claude');
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, reply}));
      })
      .catch(e => {
        console.error('[CHAT ERROR]', e.message);
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, error:e.message}));
      });
    return;
  }

  // ── Serve static files ───────────────────────────────────────────
  if (req.url === '/') {
    res.writeHead(302, { Location: '/index.html' });
    return res.end();
  }
  // /tienda and /store → full-featured store (with admin)
  if (req.url === '/tienda' || req.url === '/store') {
    res.writeHead(302, { Location: '/store.html' });
    return res.end();
  }
  const filePath = path.join(ROOT, req.url.split('?')[0]);
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const headers = {'Content-Type': mime(path.extname(filePath).toLowerCase())};
    // Never let the browser cache custom uploaded images
    if (path.basename(filePath).includes('_custom.')) {
      headers['Cache-Control'] = 'no-store, must-revalidate';
      headers['Pragma']        = 'no-cache';
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).on('error', e => {
      console.error('[FILE ERROR]', e.message);
      if (!res.writableEnded) res.end();
    }).pipe(res);
  });
});

server.on('error', e => console.error('[SERVER ERROR]', e.message));

server.listen(PORT, () => {
  console.log('\nTengo-Sed catalog server running:\n');
  console.log('  Clientes : http://localhost:' + PORT + '/catalog.html');
  console.log('  Admin    : http://localhost:' + PORT + '/catalog.html?admin=tessa1234\n');
});
