// ===========================================================================
// Tessa — Calc core v2  (per-store)
//
// Written against the REAL ControlVentas exports found in
// G:\Mi unidad\Inventario\<store>\Uploads  on 2026-08-03.
//
// This file is the single source of truth for the math. It is embedded verbatim
// into the n8n Code node by build-flow-a-v2.js, and exercised against the real
// exports by test-calc-core-v2.js. Edit here, never in the workflow JSON.
// ===========================================================================

// ======== EDIT THIS BLOCK ==================================================
const CONFIG = {
  // Only ACTIVE selling stores. Red and White is warehouse-only: its Drive
  // folder exists but stays empty, so it is deliberately absent here.
  // Chat ids are the SUPERGROUP ids. Telegram silently migrated both groups to
  // supergroups when the bot was made admin; the original "-5391668896" style
  // ids still appear in the message payload but stop working. The real id comes
  // from migrate_to_chat_id. Verified by sending to both on 2026-08-03.
  stores: {
    'Tengo Sed':  { uploadsFolderId: '17LKTSeQCB1ZYdi8OdlpJNEjR8SbheBQs', chatId: '-1004441790999' },
    'Los Negros': { uploadsFolderId: '1BfjcRpN18hkUCTy9VvwU6nn6KAkTmU-4', chatId: '-1003585797649' },
  },
  ownerChatId: '6905734880',

  // Real column names, confirmed against the exports. Candidates are tried in
  // order so a ControlVentas rename degrades to a clear error, not bad math.
  inv: {
    sku:   ['codigo', 'código', 'sku', 'barcode', 'ean'],
    name:  ['nombre', 'producto', 'descripcion'],
    stock: ['cantidad', 'stock', 'existencia'],
    price: ['precio_venta', 'precio venta', 'pvp'],
    cost:  ['precio_compra', 'precio compra', 'cpp'],
    min:   ['stock_minimo', 'stock minimo', 'minimo', 'mínimo'],
    store: ['bodega', 'local', 'sucursal'],
  },
  sales: {
    sku:   ['código', 'codigo', 'sku'],
    name:  ['producto', 'nombre'],
    sold:  ['unidades', 'vendido', 'cantidad_vendida'],
    amount:['monto total', 'monto'],
    price: ['precio venta', 'precio_venta'],
    cost:  ['cpp', 'p.compra'],
  },

  // stock_minimo comes through EMPTY in every real export, so a fixed-minimum
  // rule would be meaningless. Velocity is the default for that reason.
  //   'velocity' -> reorder when stock < unitsSoldInPeriod * coverDays / periodDays
  //   'fixed'    -> reorder when stock <= stock_minimo (or minDefault)
  reorderRule: 'velocity',
  // The window the ventas export actually covers. CONFIRMED by the user
  // 2026-08-07: exports are uploaded to Drive every 3 days, so each one holds
  // 3 days of sales. This directly scales every reorder quantity — reading a
  // 3-day export as 1 day would triple every order.
  periodDays: 3,
  coverDays: 7,      // days of stock we want on hand
  minDefault: 6,

  // Known catch-all buckets. These absorb unscanned sales, so their quantities
  // are fiction (Suelto 1f sat at -11.473 on 2026-07-27). They are excluded
  // from reorder — otherwise they monopolise the list — and reported in their
  // own section instead. See the inventory-catchall-buckets note.
  bucketPatterns: ['suelto', 'vaso', 'brandy', 'encendador', 'encendedor'],

  varianceThreshold: 1,   // ignore variances under this many units
  maxLines: 25,           // lines per Telegram section
  telegramLimit: 3890,

  // Warn when the newest file in the store's Uploads folder is older than this.
  // Uploads happen every 3 days, so 4 is the first day a file is genuinely late
  // — warning at 2 would cry wolf on every normal in-between day.
  fileStaleDays: 4,

  // Daily work dispatched to each store's group.
  // Runs Sunday-Friday; Saturday is off (see workingDayIndex).
  negativesPerDay: 8,     // negative-stock products to fix
  countPerDay: 8,         // products to physically count
};
// ===========================================================================

// ---- column resolution ----------------------------------------------------
function pick(row, candidates, what, fileLabel) {
  const keys = Object.keys(row || {});
  const norm = k => String(k).trim().toLowerCase();
  for (const c of candidates) {
    const hit = keys.find(k => norm(k) === c);
    if (hit !== undefined) return hit;
  }
  for (const c of candidates) {
    const hit = keys.find(k => norm(k).includes(c));
    if (hit !== undefined) return hit;
  }
  if (what) {
    throw new Error(
      'No encontre la columna "' + what + '" en ' + fileLabel +
      '. Cabecera real: [' + keys.join(', ') + ']. ' +
      'Agrega el nombre real a CONFIG.'
    );
  }
  return null;
}

// ---- number parsing -------------------------------------------------------
// ControlVentas mixes two conventions in the SAME file. Verified over ~1500
// real rows:
//   Unidades : "6.000"      -> 6      (lone dot is a DECIMAL point, 3 dp)
//   Stock    : "22,000"     -> 22     (comma decimal)
//   Stock    : "3.876,000"  -> 3876   (dot thousands + comma decimal)
//   Stock    : "-56,000"    -> -56    (negatives are real and common)
//   money    : "178000"     -> 178000 (NEVER carries a separator)
//
// The old parser read "6.000" as 6000 — a silent 1000x error on every quantity.
// Rule that resolves it: a dot only means "thousands" when a comma is also
// present to claim the decimal role. Otherwise a lone dot is the decimal point.
function qty(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;

  let s = String(v).trim().replace(/\s|\u00a0|\$/g, '');
  if (!s) return 0;

  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/^[-(]/, '').replace(/\)$/, '');

  let normalized;
  if (s.includes(',')) {
    normalized = s.replace(/\./g, '').replace(',', '.');   // 3.876,000 -> 3876.000
  } else {
    normalized = s;                                        // 6.000 -> 6.000 (decimal)
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

// Money in these exports is a bare integer, but stay tolerant of a hand-edited
// file: here a lone dot before exactly three digits IS a thousands separator.
function money(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;

  let s = String(v).trim().replace(/\s|\u00a0|\$/g, '');
  if (!s) return 0;

  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/^[-(]/, '').replace(/\)$/, '');

  let normalized;
  if (s.includes(',')) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    normalized = s.replace(/\./g, '');                     // 12.990 -> 12990
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

// A product key can be a real EAN, an internal PROD-XXXX code, or several
// barcodes joined by "/" (e.g. "7796776377967602/77989086"). Indexing every
// part is what makes the inventory/sales merge actually line up.
function keysOf(v) {
  const raw = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  if (!raw) return [];
  return raw.split('/').map(s => s.trim()).filter(Boolean);
}

// Sort key for the daily lists. Products are walked in alphabetical order by
// name, but a leading number must not park the whole "120 ..." family at the
// top: "120 CAB.SOV" files under C, "120 Tinto 500 ML" under T. So the key
// starts at the first actual letter, with the raw name as the tie-breaker.
function nameKey(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  const m = s.match(/[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/);
  return (m ? s.slice(m.index) : s).toLocaleLowerCase('es');
}

function byName(a, b) {
  const ka = nameKey(a.name), kb = nameKey(b.name);
  const c = ka.localeCompare(kb, 'es', { numeric: true, sensitivity: 'base' });
  if (c !== 0) return c;
  return String(a.name).localeCompare(String(b.name), 'es', { numeric: true });
}

function clp(n) {
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(Math.round(n)).toLocaleString('es-CL');
}

// ---- reading what the store replies ---------------------------------------
/**
 * Parse a store's reply into counts. Accepts the shapes people actually type:
 *   7801620001643 22      7801620001643: 22      7801620001643 - 22
 *   PROD-XWNDHVRL 0       7801620001643=22       7801620001643 x22
 *
 * Deliberately strict about what counts as a reply: ordinary chat in the group
 * must not be swallowed as a count. A message only counts when at least half of
 * its non-empty lines parse AND at least one does. Unknown SKUs and unreadable
 * lines are reported back rather than dropped — never guessed.
 *
 * @param {string} text          message text, or the caption of a photo
 * @param {Set<string>} known    SKUs currently outstanding for this store
 */
function parseCountReply(text, known) {
  const raw = String(text === null || text === undefined ? '' : text);
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const counts = [];
  const unknown = [];
  const unparsed = [];
  const seen = new Set();

  // SKU, then a separator, then a number. The SKU may be digits or PROD-XXXX.
  const RE = /^([A-Za-z0-9][A-Za-z0-9._\-\/]*)\s*(?::|-|=|x|\s)\s*(-?\d+(?:[.,]\d+)?)\s*(?:un|unid|unidades|u)?$/i;

  for (const line of lines) {
    const m = line.match(RE);
    if (!m) { unparsed.push(line); continue; }

    const sku = String(m[1]).trim().toUpperCase();
    const q = qty(m[2]);
    if (!Number.isFinite(q)) { unparsed.push(line); continue; }

    // A bare number or a word is not a SKU.
    if (!/\d/.test(sku) && !sku.startsWith('PROD-')) { unparsed.push(line); continue; }

    if (seen.has(sku)) {
      // Same SKU twice in one message: the later line wins, like a correction.
      const idx = counts.findIndex(c => c.sku === sku);
      if (idx >= 0) counts[idx] = { sku: sku, qty: q };
      continue;
    }
    seen.add(sku);

    if (known && known.size && !known.has(sku)) { unknown.push({ sku: sku, qty: q }); continue; }
    counts.push({ sku: sku, qty: q });
  }

  const parsedLines = counts.length + unknown.length;
  const isCountReply = parsedLines > 0 && parsedLines * 2 >= lines.length;

  return { counts: counts, unknown: unknown, unparsed: unparsed,
           isCountReply: isCountReply, lines: lines.length };
}

/**
 * Confirmation sent back to the store. Says exactly what was recorded, what was
 * not understood, and what is still missing — so a partial reply is obvious.
 */
function buildCountConfirmation(storeName, parsed, stillOpen, photoSaved) {
  const L = [];
  L.push('RECIBIDO — ' + storeName);
  L.push(SEP);
  if (parsed.counts.length) {
    L.push('Anotado (' + parsed.counts.length + '):');
    parsed.counts.forEach(function (c, i) { L.push(pad(i + 1) + '. ' + c.sku + '  =  ' + c.qty); });
  } else {
    L.push('No anote ninguna cantidad.');
  }
  if (photoSaved) {
    L.push('');
    L.push('Foto guardada como respaldo.');
  }
  if (parsed.unknown.length) {
    L.push('');
    L.push('SKU que no son de la lista de hoy:');
    parsed.unknown.forEach(function (c) { L.push('  ' + c.sku); });
    L.push('Revisa el codigo, o mandalo igual y lo reviso.');
  }
  if (parsed.unparsed.length) {
    L.push('');
    L.push('No entendi estas lineas:');
    parsed.unparsed.slice(0, 5).forEach(function (s) { L.push('  ' + s); });
    L.push('Formato: SKU cantidad');
  }
  L.push('');
  if (stillOpen && stillOpen.length) {
    L.push('FALTAN ' + stillOpen.length + ':');
    stillOpen.slice(0, 12).forEach(function (p, i) { L.push(pad(i + 1) + '. ' + p.name + '  ->  ' + p.sku); });
    if (stillOpen.length > 12) L.push('  ...y ' + (stillOpen.length - 12) + ' mas.');
  } else {
    L.push('Listo, respondiste todo. Manana van productos nuevos.');
  }
  const text = L.join('\n');
  return text.length > CONFIG.telegramLimit
    ? text.slice(0, CONFIG.telegramLimit) + '\n...(cortado)'
    : text;
}

/** Asked when a photo arrives with no caption. Never guess the numbers. */
function buildPhotoNeedsCaption(storeName, stillOpen) {
  const L = [];
  L.push('FOTO RECIBIDA — ' + storeName);
  L.push(SEP);
  L.push('Guarde la foto, pero no puedo saber que cantidad anotar.');
  L.push('Reenviala con el texto en el pie de foto, o escribelo aparte:');
  L.push('');
  L.push('  SKU cantidad');
  if (stillOpen && stillOpen.length) {
    L.push('');
    L.push('Ejemplo con lo que falta hoy:');
    L.push('  ' + stillOpen[0].sku + ' 4');
  }
  return L.join('\n');
}

// ---- Telegram Q&A ---------------------------------------------------------
/** Split "/stock corona 6 pack" into { cmd:'stock', args:'corona 6 pack' }. */
function parseCommand(text) {
  const raw = String(text === null || text === undefined ? '' : text).trim();
  const m = raw.match(/^\/([a-zA-Z_]+)(?:@\S+)?\s*([\s\S]*)$/);
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), args: (m[2] || '').trim() };
}

/**
 * Find products by SKU, exact name, or word-subset match. Returns ALL matches —
 * the caller shows them rather than picking one, because guessing which "Corona"
 * the user meant is exactly the failure mode the master doc forbids.
 */
function findProducts(rows, cols, term) {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);

  const out = [];
  for (const r of rows) {
    const ks = keysOf(r[cols.sku]);
    const name = String(r[cols.name] === undefined || r[cols.name] === null ? '' : r[cols.name]).trim();
    const hay = name.toLowerCase();

    let hit = false;
    if (ks.some(k => k.toLowerCase() === q)) hit = true;              // exact SKU
    else if (hay === q) hit = true;                                    // exact name
    else if (words.every(w => hay.includes(w))) hit = true;            // all words present

    if (hit) {
      out.push({
        sku: ks[0] || '',
        name: name || (ks[0] || ''),
        stock: qty(r[cols.stock]),
        price: cols.price ? money(r[cols.price]) : 0,
        cost: cols.cost ? money(r[cols.cost]) : 0,
      });
    }
  }
  return out;
}

/**
 * Answer one command against the store's own data. Deterministic — no LLM, no
 * guessing. Unknown commands and empty results say so plainly.
 */
function answerCommand(storeName, cmd, args, invRows, salesRows) {
  const HELP = [
    'COMANDOS — ' + storeName,
    SEP,
    '/stock <producto>    stock de un producto',
    '/precio <producto>   precio de venta y compra',
    '/bajos               que hay que reponer',
    '/negativos           productos en negativo',
    '/resumen             resumen del local',
    '/ayuda               esta lista',
    '',
    'Tambien puedes responder conteos:',
    '  SKU cantidad   (una linea por producto)',
    'o mandar una foto con ese texto en el pie de foto.',
  ].join('\n');

  if (cmd === 'ayuda' || cmd === 'help' || cmd === 'start') return HELP;

  if (!invRows || !invRows.length) {
    return 'No pude leer el inventario de ' + storeName + '. Revisa que haya un archivo en Uploads.';
  }

  const cols = {
    sku: pick(invRows[0], CONFIG.inv.sku, 'codigo/SKU', 'inventario ' + storeName),
    name: pick(invRows[0], CONFIG.inv.name, 'nombre', 'inventario ' + storeName),
    stock: pick(invRows[0], CONFIG.inv.stock, 'cantidad', 'inventario ' + storeName),
    price: pick(invRows[0], CONFIG.inv.price, null),
    cost: pick(invRows[0], CONFIG.inv.cost, null),
  };

  if (cmd === 'stock' || cmd === 'precio' || cmd === 'inventario') {
    if (!args) return 'Escribe que producto buscas. Ejemplo: /' + cmd + ' corona';
    const found = findProducts(invRows, cols, args);
    if (!found.length) return 'No encontre "' + args + '" en ' + storeName + '.';

    found.sort(byName);
    const L = [];
    L.push((cmd === 'precio' ? 'PRECIO' : 'STOCK') + ' — ' + storeName);
    L.push('Busqueda: ' + args + '  (' + found.length + ' resultado' + (found.length > 1 ? 's' : '') + ')');
    L.push(SEP);
    found.slice(0, 20).forEach(function (p, i) {
      L.push(pad(i + 1) + '. ' + p.name);
      if (cmd === 'precio') {
        L.push('    venta ' + clp(p.price) + '   compra ' + clp(p.cost));
      } else {
        L.push('    quedan ' + p.stock + (p.stock < 0 ? '   (NEGATIVO)' : ''));
      }
      L.push('    SKU: ' + p.sku);
    });
    if (found.length > 20) L.push('  ...y ' + (found.length - 20) + ' mas. Se mas especifico.');
    const t = L.join('\n');
    return t.length > CONFIG.telegramLimit ? t.slice(0, CONFIG.telegramLimit) + '\n...(cortado)' : t;
  }

  if (cmd === 'bajos' || cmd === 'negativos' || cmd === 'resumen') {
    const res = calcStore(storeName, invRows, salesRows || [], [], undefined, null);
    if (cmd === 'resumen') return res.report;

    const list = cmd === 'bajos' ? res.reorders : res.negatives;
    if (!list.length) {
      return (cmd === 'bajos' ? 'No hay nada que reponer en ' : 'No hay stock negativo en ') + storeName + '.';
    }
    const L = [];
    L.push((cmd === 'bajos' ? 'REPONER' : 'STOCK NEGATIVO') + ' — ' + storeName);
    L.push(SEP);
    list.slice(0, 25).forEach(function (p, i) {
      L.push(pad(i + 1) + '. ' + p.name);
      L.push(cmd === 'bajos'
        ? '    PEDIR ' + p.suggest + '   (quedan ' + p.stock + ', vendio ' + p.sold + ')'
        : '    sistema: ' + p.stock);
    });
    if (list.length > 25) L.push('  ...y ' + (list.length - 25) + ' mas.');
    const t = L.join('\n');
    return t.length > CONFIG.telegramLimit ? t.slice(0, CONFIG.telegramLimit) + '\n...(cortado)' : t;
  }

  return 'No conozco el comando /' + cmd + '.\n\n' + HELP;
}

// ---- the actual calculation ----------------------------------------------
/**
 * @param {string} storeName
 * @param {Array<object>} invRows    rows of the inventory .xlsx export
 * @param {Array<object>} salesRows  rows of the ventas .csv export
 * @param {Array<object>} countRows  physical counts [{sku, qty}] (may be empty)
 * @returns {object} report payload for this store
 */
function calcStore(storeName, invRows, salesRows, countRows, state, files) {
  invRows = (invRows || []).filter(r => r && Object.keys(r).length);
  salesRows = (salesRows || []).filter(r => r && Object.keys(r).length);
  countRows = (countRows || []).filter(r => r && Object.keys(r).length);

  if (!invRows.length) {
    throw new Error('Local ' + storeName + ': el archivo de inventario esta vacio o no se pudo leer. Sin stock no hay reporte.');
  }

  const I = {
    sku:   pick(invRows[0], CONFIG.inv.sku,   'codigo/SKU', 'inventario ' + storeName),
    name:  pick(invRows[0], CONFIG.inv.name,  'nombre',     'inventario ' + storeName),
    stock: pick(invRows[0], CONFIG.inv.stock, 'cantidad',   'inventario ' + storeName),
    price: pick(invRows[0], CONFIG.inv.price, null),
    cost:  pick(invRows[0], CONFIG.inv.cost,  null),
    min:   pick(invRows[0], CONFIG.inv.min,   null),
  };

  const S = salesRows.length ? {
    sku:    pick(salesRows[0], CONFIG.sales.sku,   'codigo/SKU', 'ventas ' + storeName),
    sold:   pick(salesRows[0], CONFIG.sales.sold,  'unidades',   'ventas ' + storeName),
    amount: pick(salesRows[0], CONFIG.sales.amount, null),
    price:  pick(salesRows[0], CONFIG.sales.price,  null),
  } : null;

  // sales indexed by every barcode variant
  const soldBy = new Map();
  let revenue = 0;
  if (S) {
    for (const r of salesRows) {
      const units = qty(r[S.sold]);
      const amt = S.amount ? money(r[S.amount]) : 0;
      revenue += amt;
      for (const k of keysOf(r[S.sku])) {
        const prev = soldBy.get(k) || { units: 0, amount: 0 };
        soldBy.set(k, { units: prev.units + units, amount: prev.amount + amt });
      }
    }
  }

  // physical counts indexed the same way
  const countBy = new Map();
  for (const r of countRows) {
    const sku = r.sku !== undefined ? r.sku : r.SKU;
    const q = qty(r.qty !== undefined ? r.qty : r.cantidad);
    for (const k of keysOf(sku)) countBy.set(k, q);
  }

  const isBucket = name =>
    CONFIG.bucketPatterns.some(p => name.toLowerCase().includes(p));

  const variances = [];
  const reorders = [];
  const negatives = [];
  const buckets = [];
  const countable = [];   // catalogue used for the daily physical count
  let stockValue = 0;
  let counted = 0;

  for (const row of invRows) {
    const ks = keysOf(row[I.sku]);
    if (!ks.length) continue;
    const name = String(row[I.name] === undefined || row[I.name] === null ? '' : row[I.name]).trim() || ks[0];
    const stock = qty(row[I.stock]);
    const price = I.price ? money(row[I.price]) : 0;
    const cost = I.cost ? money(row[I.cost]) : 0;

    stockValue += stock * (cost || price);

    const bucket = isBucket(name);
    if (bucket) buckets.push({ sku: ks[0], name: name, stock: stock });
    // Buckets are excluded from counting too — counting "Suelto 1f" is pointless.
    if (!bucket) countable.push({ sku: ks[0], name: name, stock: stock });

    // Negative stock is a real, frequent condition in these exports and it is
    // always a data-integrity problem worth surfacing on its own.
    if (stock < 0 && !bucket) negatives.push({ sku: ks[0], name: name, stock: stock });

    // --- variance: system stock vs physical count ---
    let cnt;
    for (const k of ks) if (countBy.has(k)) { cnt = countBy.get(k); break; }
    if (cnt !== undefined) {
      counted++;
      const diff = cnt - stock;           // negative = falta mercaderia
      if (Math.abs(diff) >= CONFIG.varianceThreshold) {
        variances.push({
          sku: ks[0], name: name, system: stock, counted: cnt,
          diff: diff, value: diff * (cost || price),
        });
      }
    }

    // --- reorder ---
    let sold = 0;
    for (const k of ks) if (soldBy.has(k)) { sold = soldBy.get(k).units; break; }

    let threshold;
    if (CONFIG.reorderRule === 'velocity') {
      const perDay = sold / Math.max(1, CONFIG.periodDays);
      threshold = Math.ceil(perDay * CONFIG.coverDays);
    } else {
      threshold = I.min ? (qty(row[I.min]) || CONFIG.minDefault) : CONFIG.minDefault;
    }

    // A product that never sells should not be reordered just for sitting at 0,
    // and a catch-all bucket must never drive a purchase order.
    if (threshold > 0 && stock < threshold && !bucket) {
      reorders.push({
        sku: ks[0], name: name, stock: stock, sold: sold,
        threshold: threshold, suggest: Math.max(1, Math.ceil(threshold - stock)),
      });
    }
  }

  variances.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  reorders.sort((a, b) => (b.sold - a.sold) || (a.stock - b.stock));
  negatives.sort((a, b) => a.stock - b.stock);

  const varianceValue = variances.reduce((s, v) => s + v.value, 0);

  const day = workingDayIndex();
  countable.sort(byName);

  // A product counts as "answered" once any reply for it exists in the conteos
  // table. Every barcode variant of the SKU is accepted so a store replying with
  // the second barcode of a multi-code product still closes the item.
  const answered = new Set();
  for (const r of countRows) {
    const sku = r.sku !== undefined ? r.sku : r.SKU;
    for (const k of keysOf(sku)) answered.add(k);
  }

  const st = state || {};
  const negTask = buildNegativesTask(storeName, negatives, st.negatives, answered);
  const cntTask = buildCountTask(storeName, countable, st.count, answered);
  const nextState = { negatives: negTask.state, count: cntTask.state };
  const filesWarn = buildFilesWarning(storeName, files);

  return {
    store: storeName,
    generatedAt: new Date().toISOString(),
    products: invRows.length,
    salesRows: salesRows.length,
    revenue: revenue,
    stockValue: stockValue,
    counted: counted,
    variances: variances,
    varianceValue: varianceValue,
    reorders: reorders,
    negatives: negatives,
    buckets: buckets,
    day: day,
    negativesTask: negTask.text,
    negativesBatch: negTask.batch,
    negativesResent: negTask.resent,
    countTask: cntTask.text,
    countBatch: cntTask.batch,
    countResent: cntTask.resent,
    nextState: nextState,
    filesStale: filesWarn.stale,
    filesTask: filesWarn.text,
    invAgeDays: filesWarn.invAgeDays,
    venAgeDays: filesWarn.venAgeDays,
    report: buildReport(storeName, {
      products: invRows.length, revenue: revenue, counted: counted,
      variances: variances, varianceValue: varianceValue,
      reorders: reorders, negatives: negatives, buckets: buckets,
      filesStale: filesWarn.stale, invAgeDays: filesWarn.invAgeDays,
      venAgeDays: filesWarn.venAgeDays,
    }),
  };
}

// ---- daily rotating work lists --------------------------------------------
// Both lists rotate by day so the store eventually walks the whole catalogue
// instead of being handed the same worst offenders forever. The rotation is a
// pure function of the date, so a re-run on the same day is idempotent — the
// store never gets two different lists for one day.
function dayIndex(now) {
  const d = now || new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

// The store works Sunday-Friday and rests Saturday. If the rotation were driven
// by the raw calendar day, every Saturday's 8 products would be skipped and
// never come back around. Counting only working days keeps the walk contiguous:
// consecutive dispatches always advance by exactly 1.
// Day 0 (1970-01-01) was a Thursday, so Saturdays are the days where n % 7 === 2.
function saturdaysUpTo(n) {
  return n < 2 ? 0 : Math.floor((n - 2) / 7) + 1;
}

function workingDayIndex(now) {
  const n = dayIndex(now);
  return n - saturdaysUpTo(n);
}

function isSaturday(now) {
  const d = now || new Date();
  return d.getDay() === 6;
}

function rotate(list, perDay, day) {
  if (!list.length || perDay <= 0) return [];
  const out = [];
  const start = (day * perDay) % list.length;
  for (let i = 0; i < Math.min(perDay, list.length); i++) {
    out.push(list[(start + i) % list.length]);
  }
  return out;
}

/**
 * Reply-driven batching. The store only moves on to new products once it has
 * answered the current ones — an unanswered batch is re-sent unchanged rather
 * than being buried under a fresh list. The cursor advances ONLY when the
 * outstanding batch is fully cleared, so nothing is ever skipped.
 *
 * @param {Array<{sku:string,name:string}>} list   full ordered catalogue
 * @param {{cursor:number, pending:string[]}} state  persisted between runs
 * @param {Set<string>} answered                   SKUs replied to since the send
 * @param {number} perDay
 * @returns {{batch:Array, state:object, resent:boolean, cleared:string[]}}
 */
function nextBatch(list, state, answered, perDay) {
  const prev = { cursor: (state && state.cursor) || 0, pending: (state && state.pending) || [] };
  const cleared = prev.pending.filter(s => answered.has(s));
  const stillOpen = prev.pending.filter(s => !answered.has(s));

  if (!list.length || perDay <= 0) {
    return { batch: [], state: { cursor: prev.cursor, pending: [] }, resent: false, cleared: cleared };
  }

  // Something is still outstanding -> repeat exactly those, add nothing new.
  if (stillOpen.length) {
    const byKey = new Map(list.map(p => [String(p.sku), p]));
    const batch = stillOpen.map(s => byKey.get(s)).filter(Boolean);
    if (batch.length) {
      return {
        batch: batch,
        // `items` carries the names too, so the 17:30 reminder can name the
        // products without re-reading the whole inventory file.
        state: { cursor: prev.cursor, pending: batch.map(p => String(p.sku)), items: batch },
        resent: true, cleared: cleared,
      };
    }
    // Everything outstanding vanished from the catalogue (product deleted /
    // renamed). Treat the batch as closed rather than looping on ghosts.
  }

  // Batch cleared -> advance to the next slice.
  const start = ((prev.cursor % list.length) + list.length) % list.length;
  const batch = [];
  for (let i = 0; i < Math.min(perDay, list.length); i++) {
    batch.push(list[(start + i) % list.length]);
  }
  return {
    batch: batch,
    state: { cursor: start + batch.length, pending: batch.map(p => String(p.sku)), items: batch },
    resent: false, cleared: cleared,
  };
}

/**
 * What is still unanswered right now. Used by the afternoon reminder — it reads
 * the batch that was already sent instead of recomputing one, so the reminder
 * can never introduce new products or advance the cursor.
 */
function outstandingFrom(state, answered) {
  const items = (state && state.items) || [];
  return items.filter(p => !answered.has(String(p.sku)));
}

/**
 * How old the store's two exports are, and the nag to upload fresh ones.
 * @param {{inventory?:string, ventas?:string}} files  modifiedTime ISO strings
 */
function buildFilesWarning(storeName, files, now) {
  const ref = now || new Date();
  const ageDays = iso => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.floor((ref.getTime() - t) / 86400000);
  };

  const inv = ageDays(files && files.inventory);
  const ven = ageDays(files && files.ventas);
  const late = [];
  if (inv === null) late.push('INVENTARIO: no hay archivo');
  else if (inv >= CONFIG.fileStaleDays) late.push('INVENTARIO: ultimo archivo de hace ' + inv + ' dias');
  if (ven === null) late.push('VENTAS: no hay archivo');
  else if (ven >= CONFIG.fileStaleDays) late.push('VENTAS: ultimo archivo de hace ' + ven + ' dias');

  if (!late.length) return { stale: false, text: '', invAgeDays: inv, venAgeDays: ven };

  const L = [];
  L.push('SUBIR ARCHIVOS — ' + storeName);
  L.push(SEP);
  late.forEach(function (s, i) { L.push(pad(i + 1) + '. ' + s); });
  L.push('');
  L.push('Exporta de ControlVentas y sube el archivo a la carpeta');
  L.push('Uploads de ' + storeName + ' en Google Drive.');
  L.push('Sin archivo nuevo el reporte queda con datos viejos.');
  return { stale: true, text: L.join('\n'), invAgeDays: inv, venAgeDays: ven };
}

function buildReminder(storeName, negOpen, cntOpen) {
  if (!negOpen.length && !cntOpen.length) return '';
  const L = [];
  L.push('RECORDATORIO — ' + storeName);
  L.push('Todavia falta responder lo de hoy. Responde: SKU cantidad');
  if (negOpen.length) {
    L.push('');
    L.push('AJUSTE DE STOCK (' + negOpen.length + ' sin responder)');
    negOpen.forEach(function (p) { L.push('  ' + p.name + '  ->  ' + p.sku); });
  }
  if (cntOpen.length) {
    L.push('');
    L.push('CONTEO DEL DIA (' + cntOpen.length + ' sin responder)');
    cntOpen.forEach(function (p) { L.push('  ' + p.name + '  ->  ' + p.sku); });
  }
  L.push('');
  L.push('Ejemplo: ' + (negOpen[0] || cntOpen[0]).sku + ' 3');
  const text = L.join('\n');
  return text.length > CONFIG.telegramLimit
    ? text.slice(0, CONFIG.telegramLimit) + '\n...(cortado)'
    : text;
}

function buildNegativesTask(storeName, negatives, state, answered) {
  const sorted = negatives.slice().sort(byName);
  const r = nextBatch(sorted, state, answered, CONFIG.negativesPerDay);
  const batch = r.batch;
  if (!batch.length) {
    return { batch: batch, state: r.state, resent: false,
             text: 'AJUSTE DE STOCK — ' + storeName + '\nNo hay productos en negativo. Todo en orden.' };
  }
  const L = [];
  L.push('AJUSTE DE STOCK — ' + storeName);
  if (r.resent) {
    L.push('(REPETIDO - faltan estos ' + batch.length + ' por responder)');
  }
  L.push('Estos ' + batch.length + ' productos estan en NEGATIVO. Cuenta cuantos hay de verdad');
  L.push('en la tienda y responde una linea por producto: SKU cantidad');
  L.push('');
  batch.forEach(function (n, i) {
    L.push((i + 1) + ') ' + n.name);
    L.push('   sistema: ' + n.stock + '   SKU: ' + n.sku);
  });
  L.push('');
  L.push('Ejemplo de respuesta:');
  L.push(batch[0].sku + ' 4');
  L.push('(quedan ' + Math.max(0, negatives.length - batch.length) + ' negativos para los proximos dias)');
  return { batch: batch, state: r.state, resent: r.resent, text: L.join('\n') };
}

function buildCountTask(storeName, products, state, answered) {
  const r = nextBatch(products, state, answered, CONFIG.countPerDay);
  const batch = r.batch;
  if (!batch.length) return { batch: batch, state: r.state, resent: false, text: '' };
  const L = [];
  L.push('CONTEO DEL DIA — ' + storeName);
  if (r.resent) {
    L.push('(REPETIDO - faltan estos ' + batch.length + ' por responder)');
  }
  L.push('Cuenta estos ' + batch.length + ' productos y responde: SKU cantidad');
  L.push('');
  batch.forEach(function (p, i) {
    L.push((i + 1) + ') ' + p.name);
    L.push('   SKU: ' + p.sku);
  });
  L.push('');
  L.push('Ejemplo: ' + batch[0].sku + ' 12');
  L.push('No mires el sistema antes de contar.');
  return { batch: batch, state: r.state, resent: r.resent, text: L.join('\n') };
}

// ---- plain-text Telegram report (no emoji, per the master doc) -------------
// House style, applied to every message the team sends: a titled block, a rule
// under it, numbered items, and the action word first on the detail line. Long
// runs of "name: a, b -> c" are unreadable on a phone.
const SEP = '--------------------------------';

function pad(n) {
  return (n < 10 ? ' ' : '') + n;
}

function buildReport(storeName, d) {
  const L = [];
  L.push('INVENTARIO — ' + storeName);
  L.push(new Date().toLocaleDateString('es-CL'));
  L.push(SEP);
  // A stale export invalidates everything below it, so it leads the message.
  if (d.filesStale) {
    L.push('OJO: ARCHIVOS DESACTUALIZADOS');
    if (d.invAgeDays === null) L.push('  inventario: falta archivo');
    else if (d.invAgeDays >= CONFIG.fileStaleDays) L.push('  inventario: ' + d.invAgeDays + ' dias');
    if (d.venAgeDays === null) L.push('  ventas: falta archivo');
    else if (d.venAgeDays >= CONFIG.fileStaleDays) L.push('  ventas: ' + d.venAgeDays + ' dias');
    L.push('  Los numeros de abajo son de esa fecha.');
    L.push(SEP);
  }
  L.push('Productos:  ' + d.products);
  L.push('Venta:      ' + clp(d.revenue));
  L.push('');

  if (d.counted > 0) {
    L.push('CONTEO FISICO (' + d.counted + ' productos contados)');
    if (!d.variances.length) {
      L.push('Sin diferencias.');
    } else {
      L.push('Diferencias: ' + d.variances.length + '  |  ' + clp(d.varianceValue));
      for (const v of d.variances.slice(0, CONFIG.maxLines)) {
        L.push('  ' + v.name + ': sistema ' + v.system + ' / contado ' + v.counted +
               ' = ' + (v.diff > 0 ? '+' : '') + v.diff + ' (' + clp(v.value) + ')');
      }
      if (d.variances.length > CONFIG.maxLines) {
        L.push('  ...y ' + (d.variances.length - CONFIG.maxLines) + ' mas.');
      }
    }
    L.push('');
  } else {
    L.push('CONTEO FISICO: sin conteo recibido hoy.');
    L.push('');
  }

  if (d.reorders.length) {
    L.push(SEP);
    L.push('REPONER  (' + d.reorders.length + ' productos)');
    L.push(SEP);
    d.reorders.slice(0, CONFIG.maxLines).forEach(function (r, i) {
      L.push(pad(i + 1) + '. ' + r.name);
      L.push('    PEDIR ' + r.suggest + '   (quedan ' + r.stock + ', vendio ' + r.sold + ')');
    });
    if (d.reorders.length > CONFIG.maxLines) {
      L.push('    ...y ' + (d.reorders.length - CONFIG.maxLines) + ' productos mas.');
    }
    L.push('');
  }

  if (d.negatives.length) {
    L.push(SEP);
    L.push('STOCK NEGATIVO  (' + d.negatives.length + ' productos)');
    L.push('hay movimiento sin registrar');
    L.push(SEP);
    d.negatives.slice(0, 10).forEach(function (n, i) {
      L.push(pad(i + 1) + '. ' + n.name);
      L.push('    sistema: ' + n.stock);
    });
    if (d.negatives.length > 10) {
      L.push('    ...y ' + (d.negatives.length - 10) + ' productos mas.');
    }
    L.push('');
  }

  if (d.buckets && d.buckets.length) {
    L.push(SEP);
    L.push('CANASTOS  (no se piden, cifras no confiables)');
    L.push(SEP);
    for (const b of d.buckets.slice(0, 8)) {
      L.push('  ' + b.name + ': ' + b.stock);
    }
  }

  const text = L.join('\n');
  return text.length > CONFIG.telegramLimit
    ? text.slice(0, CONFIG.telegramLimit) + '\n...(cortado)'
    : text;
}

// Exported for the test harness; the n8n Code node calls calcStore directly.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, qty, money, keysOf, pick, clp, calcStore, buildReport,
                     nameKey, byName, dayIndex, workingDayIndex, saturdaysUpTo, isSaturday,
                     nextBatch, rotate, outstandingFrom, buildReminder, buildFilesWarning,
                     parseCountReply, buildCountConfirmation, buildPhotoNeedsCaption,
                     parseCommand, findProducts, answerCommand };
}
