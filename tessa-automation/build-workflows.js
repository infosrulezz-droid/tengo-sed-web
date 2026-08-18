#!/usr/bin/env node
/**
 * Builds the two n8n workflow JSON files for the Tessa inventory agent.
 * Run: node build-workflows.js
 *
 * Why a generator instead of hand-written JSON: the Code nodes carry real
 * JavaScript. Writing that inline as escaped JSON strings is unreadable and
 * easy to break. Here the code lives in template literals and gets serialized.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Shared config block. Both Code nodes read the same constants so the reorder
// rule / SKU column / store list are changed in exactly one place.
// ---------------------------------------------------------------------------
const CONFIG = `
// ======== EDIT THIS BLOCK — everything else is generic ========================
const CONFIG = {
  // Candidate column names for the product key. The first one found in the CSV
  // header wins. Add the real ControlVentas column name at the front.
  skuColumns: ['sku', 'codigo', 'código', 'codigo_barras', 'código de barras',
               'cod_barra', 'barcode', 'ean'],

  // Candidate column names for the other fields we need.
  nameColumns:  ['nombre', 'descripcion', 'descripción', 'producto', 'name'],
  stockColumns: ['stock', 'existencia', 'existencias', 'cantidad', 'saldo'],
  countColumns: ['conteo', 'fisico', 'físico', 'contado', 'cantidad_contada'],
  soldColumns:  ['vendido', 'ventas', 'cantidad_vendida', 'unidades'],
  priceColumns: ['precio', 'precio_venta', 'pvp', 'valor'],
  minColumns:   ['minimo', 'mínimo', 'stock_minimo', 'punto_reorden'],
  storeColumns: ['local', 'sucursal', 'tienda', 'store', 'bodega'],

  // Reorder rule. 'fixed'    -> reorder when stock <= minimo column (or minDefault)
  //              'velocity'  -> reorder when stock < avg daily sales * coverDays
  reorderRule: 'fixed',
  minDefault: 6,
  coverDays: 7,

  // Flag a variance only when it is at least this many units (noise filter).
  varianceThreshold: 1,

  // Flag a price as suspicious when it is 0/blank or moved more than this ratio.
  priceJumpRatio: 0.25,

  // Stores -> Telegram chat id. Keys must match the values in the store column.
  // Use one chat id for all three if you want a single group.
  stores: {
    'LOCAL 1': 'REPLACE_CHAT_ID_1',
    'LOCAL 2': 'REPLACE_CHAT_ID_2',
    'LOCAL 3': 'REPLACE_CHAT_ID_3',
  },

  // Fallback chat when a row has no recognizable store.
  fallbackChatId: 'REPLACE_CHAT_ID_1',

  // Cycle count: how many SKUs to dispatch per store per day.
  cycleCountPerDay: 5,
};
// =============================================================================

// ---- helpers ---------------------------------------------------------------
function pick(row, candidates) {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const hit = keys.find(k => k.trim().toLowerCase() === cand);
    if (hit !== undefined) return hit;
  }
  // second pass: contains
  for (const cand of candidates) {
    const hit = keys.find(k => k.trim().toLowerCase().includes(cand));
    if (hit !== undefined) return hit;
  }
  return null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;

  let s = String(v).replace(/\\s/g, '').replace(/[$\\u00a0]/g, '');
  if (!s) return 0;

  const negative = /^\\(.*\\)$/.test(s) || s.startsWith('-');
  s = s.replace(/^[-(]/, '').replace(/\\)$/, '');

  let normalized;
  if (s.includes(',')) {
    // 1.234,56 — dots are thousands separators, comma is the decimal mark.
    normalized = s.replace(/\\./g, '').replace(',', '.');
  } else if (/^\\d{1,3}(\\.\\d{3})+$/.test(s)) {
    // 1.290 / 12.990 / 1.234.567 — every group after the first is exactly three
    // digits, so these are thousands separators, NOT a decimal point.
    normalized = s.replace(/\\./g, '');
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

function key(v) {
  return String(v ?? '').trim().toUpperCase();
}

function clp(n) {
  return '$' + Math.round(n).toLocaleString('es-CL');
}
`;

// ---------------------------------------------------------------------------
// Flow A — Calc core
// ---------------------------------------------------------------------------
const CALC_CORE = `${CONFIG}

// ---- load the three exports -------------------------------------------------
function rowsOf(nodeName) {
  try {
    return $(nodeName).all().map(i => i.json).filter(r => r && Object.keys(r).length);
  } catch (e) {
    return [];
  }
}

const stockRows = rowsOf('CSV stock');
const ventasRows = rowsOf('CSV ventas');

// Counts come from two places: the n8n Data Table (filled by stores replying to the
// cycle-count message in Telegram) and, as a fallback, a conteo.csv exported by hand.
// The Data Table wins when a SKU appears in both — it is the fresher source.
const tableRows = rowsOf('Get counts').filter(r => r.sku);
const csvConteoRows = rowsOf('CSV conteo');

// Keep only the newest count per SKU+store; stores re-send corrections.
const newest = new Map();
for (const r of tableRows) {
  const k = key(r.sku) + '::' + key(r.store);
  const prev = newest.get(k);
  if (!prev || String(r.counted_at ?? '') >= String(prev.counted_at ?? '')) newest.set(k, r);
}
const normalizedTableRows = [...newest.values()].map(r => ({
  __sku: r.sku, __store: r.store, __count: r.qty,
}));

const conteoRows = normalizedTableRows.length ? normalizedTableRows : csvConteoRows;
const countsFromTable = normalizedTableRows.length > 0;

if (!stockRows.length) {
  throw new Error('stock.csv produced no rows — check the Drive file and the CSV separator.');
}

// ---- resolve column names once ---------------------------------------------
const sample = stockRows[0];
const COL = {
  sku:   pick(sample, CONFIG.skuColumns),
  name:  pick(sample, CONFIG.nameColumns),
  stock: pick(sample, CONFIG.stockColumns),
  price: pick(sample, CONFIG.priceColumns),
  min:   pick(sample, CONFIG.minColumns),
  store: pick(sample, CONFIG.storeColumns),
};
if (!COL.sku) {
  throw new Error('No SKU column found in stock.csv. Header was: ' + Object.keys(sample).join(' | ') +
                  ' — add the real name to CONFIG.skuColumns.');
}

const vSample = ventasRows[0] || {};
const VCOL = {
  sku:   pick(vSample, CONFIG.skuColumns),
  sold:  pick(vSample, CONFIG.soldColumns),
  price: pick(vSample, CONFIG.priceColumns),
  store: pick(vSample, CONFIG.storeColumns),
};

const cSample = conteoRows[0] || {};
const CCOL = countsFromTable
  ? { sku: '__sku', count: '__count', store: '__store' }
  : {
      sku:   pick(cSample, CONFIG.skuColumns),
      count: pick(cSample, CONFIG.countColumns),
      store: pick(cSample, CONFIG.storeColumns),
    };

// ---- index sales and counts by SKU (+ store when available) -----------------
const idx = (rows, skuCol, storeCol) => {
  const m = new Map();
  if (!skuCol) return m;
  for (const r of rows) {
    const k = key(r[skuCol]) + '::' + (storeCol ? key(r[storeCol]) : '');
    m.set(k, r);
  }
  return m;
};
const salesIdx = idx(ventasRows, VCOL.sku, VCOL.store);
const countIdx = idx(conteoRows, CCOL.sku, CCOL.store);

const lookup = (m, sku, store) =>
  m.get(key(sku) + '::' + key(store)) ?? m.get(key(sku) + '::') ?? null;

// ---- the actual reconciliation ---------------------------------------------
const byStore = new Map();

for (const row of stockRows) {
  const sku = key(row[COL.sku]);
  if (!sku) continue;

  const store = COL.store ? key(row[COL.store]) : Object.keys(CONFIG.stores)[0];
  if (!byStore.has(store)) {
    byStore.set(store, { store, variances: [], reorders: [], price_flags: [], counted: 0, skus: 0 });
  }
  const bucket = byStore.get(store);
  bucket.skus++;

  const name = COL.name ? String(row[COL.name] ?? '').trim() : sku;
  const expected = num(row[COL.stock]);
  const price = COL.price ? num(row[COL.price]) : 0;

  const saleRow = lookup(salesIdx, sku, store);
  const countRow = lookup(countIdx, sku, store);

  // --- variance: system stock minus physical count -------------------------
  if (countRow && CCOL.count) {
    bucket.counted++;
    const physical = num(countRow[CCOL.count]);
    const variance = expected - physical;
    if (Math.abs(variance) >= CONFIG.varianceThreshold) {
      bucket.variances.push({
        sku, name, expected, physical, variance,
        value: variance * price,
      });
    }
  }

  // --- reorder --------------------------------------------------------------
  let needsReorder = false;
  let threshold = CONFIG.minDefault;
  if (CONFIG.reorderRule === 'velocity' && saleRow && VCOL.sold) {
    const sold = num(saleRow[VCOL.sold]);
    threshold = Math.ceil(sold * CONFIG.coverDays);
    needsReorder = expected < threshold;
  } else {
    threshold = COL.min ? (num(row[COL.min]) || CONFIG.minDefault) : CONFIG.minDefault;
    needsReorder = expected <= threshold;
  }
  if (needsReorder) {
    bucket.reorders.push({ sku, name, stock: expected, threshold, suggested: Math.max(threshold * 2 - expected, 1) });
  }

  // --- price flags ----------------------------------------------------------
  if (COL.price) {
    if (price <= 0) {
      bucket.price_flags.push({ sku, name, reason: 'precio en cero o vacio', price });
    } else if (saleRow && VCOL.price) {
      const sold_at = num(saleRow[VCOL.price]);
      if (sold_at > 0 && Math.abs(sold_at - price) / price > CONFIG.priceJumpRatio) {
        bucket.price_flags.push({
          sku, name, reason: 'precio de venta distinto al de lista', price, sold_at,
        });
      }
    }
  }
}

// ---- shape one output item per store ---------------------------------------
const today = new Date().toLocaleDateString('es-CL');
const out = [];

for (const bucket of byStore.values()) {
  bucket.variances.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  bucket.reorders.sort((a, b) => a.stock - b.stock);

  const lostValue = bucket.variances.reduce((s, v) => s + Math.max(v.value, 0), 0);

  // Plain text, no emoji, per the project rules. The AI agent can rewrite this
  // later; until then this is already a valid report.
  const lines = [];
  lines.push('Reporte de inventario - ' + bucket.store + ' - ' + today);
  lines.push('SKUs revisados: ' + bucket.skus + ' | contados hoy: ' + bucket.counted +
             ' (' + (countsFromTable ? 'conteo por Telegram' : 'conteo.csv') + ')');
  lines.push('');

  lines.push('DIFERENCIAS (' + bucket.variances.length + ')');
  if (!bucket.variances.length) {
    lines.push('  sin diferencias sobre el umbral');
  } else {
    for (const v of bucket.variances.slice(0, 15)) {
      const signo = v.variance > 0 ? 'faltan' : 'sobran';
      lines.push('  ' + v.sku + ' ' + v.name + ': sistema ' + v.expected +
                 ', fisico ' + v.physical + ' -> ' + signo + ' ' + Math.abs(v.variance) +
                 ' (' + clp(Math.abs(v.value)) + ')');
    }
    if (bucket.variances.length > 15) lines.push('  ... y ' + (bucket.variances.length - 15) + ' mas');
    lines.push('  Valor de faltantes: ' + clp(lostValue));
  }
  lines.push('');

  lines.push('REPOSICION (' + bucket.reorders.length + ')');
  if (!bucket.reorders.length) {
    lines.push('  nada bajo el minimo');
  } else {
    for (const r of bucket.reorders.slice(0, 20)) {
      lines.push('  ' + r.sku + ' ' + r.name + ': quedan ' + r.stock +
                 ' (min ' + r.threshold + ') -> pedir ' + r.suggested);
    }
    if (bucket.reorders.length > 20) lines.push('  ... y ' + (bucket.reorders.length - 20) + ' mas');
  }

  if (bucket.price_flags.length) {
    lines.push('');
    lines.push('PRECIOS A REVISAR (' + bucket.price_flags.length + ')');
    for (const p of bucket.price_flags.slice(0, 10)) {
      lines.push('  ' + p.sku + ' ' + p.name + ': ' + p.reason);
    }
  }

  let report = lines.join('\\n');
  if (report.length > 3900) report = report.slice(0, 3890) + '\\n... (truncado)';

  out.push({
    json: {
      store: bucket.store,
      chat_id: CONFIG.stores[bucket.store] ?? CONFIG.fallbackChatId,
      date: today,
      count_source: countsFromTable ? 'data_table' : 'csv',
      counts: {
        skus: bucket.skus,
        counted: bucket.counted,
        variances: bucket.variances.length,
        reorders: bucket.reorders.length,
        price_flags: bucket.price_flags.length,
        lost_value: Math.round(lostValue),
      },
      variances: bucket.variances,
      reorders: bucket.reorders,
      price_flags: bucket.price_flags,
      report,
    },
  });
}

return out;
`;

// ---------------------------------------------------------------------------
// Flow A — cycle count dispatch
// ---------------------------------------------------------------------------
const CYCLE_COUNT = `${CONFIG}

const stockRows = $('CSV stock').all().map(i => i.json).filter(r => r && Object.keys(r).length);
if (!stockRows.length) return [];

const sample = stockRows[0];
const COL = {
  sku:   pick(sample, CONFIG.skuColumns),
  name:  pick(sample, CONFIG.nameColumns),
  store: pick(sample, CONFIG.storeColumns),
};
if (!COL.sku) throw new Error('No SKU column found for the cycle count.');

// Group SKUs per store, sorted so the rotation is stable day to day.
const perStore = new Map();
for (const row of stockRows) {
  const sku = key(row[COL.sku]);
  if (!sku) continue;
  const store = COL.store ? key(row[COL.store]) : Object.keys(CONFIG.stores)[0];
  if (!perStore.has(store)) perStore.set(store, []);
  perStore.get(store).push({ sku, name: COL.name ? String(row[COL.name] ?? '').trim() : sku });
}

// Day-of-year drives the window, so the list rotates through the whole catalog
// and comes back around instead of repeating the same SKUs.
const start = new Date(new Date().getFullYear(), 0, 0);
const dayOfYear = Math.floor((Date.now() - start) / 86400000);
const today = new Date().toLocaleDateString('es-CL');

const out = [];
for (const [store, items] of perStore) {
  items.sort((a, b) => a.sku.localeCompare(b.sku));
  const n = CONFIG.cycleCountPerDay;
  const offset = (dayOfYear * n) % Math.max(items.length, 1);
  const slice = [];
  for (let i = 0; i < Math.min(n, items.length); i++) {
    slice.push(items[(offset + i) % items.length]);
  }

  const lines = ['Conteo del dia - ' + store + ' - ' + today,
                 'Contar estos ' + slice.length + ' productos y responder con las cantidades:', ''];
  slice.forEach((s, i) => lines.push('  ' + (i + 1) + '. ' + s.sku + ' ' + s.name));
  lines.push('');
  lines.push('Formato de respuesta: SKU cantidad (uno por linea)');

  out.push({
    json: {
      store,
      chat_id: CONFIG.stores[store] ?? CONFIG.fallbackChatId,
      skus: slice,
      report: lines.join('\\n'),
    },
  });
}

return out;
`;

// ---------------------------------------------------------------------------
// Flow B — command router
// ---------------------------------------------------------------------------
const COMMAND_ROUTER = `${CONFIG}

const trigger = $('Telegram trigger').first().json;
const msg = trigger.message ?? trigger.channel_post ?? {};
const text = String(msg.text ?? '').trim();
const chatId = msg.chat?.id ?? CONFIG.fallbackChatId;

const [rawCmd, ...args] = text.split(/\\s+/);
const cmd = rawCmd.replace(/@.*$/, '').toLowerCase();
const arg = args.join(' ').trim();

const stockRows = $('CSV stock').all().map(i => i.json).filter(r => r && Object.keys(r).length);
const sample = stockRows[0] ?? {};
const COL = {
  sku:   pick(sample, CONFIG.skuColumns),
  name:  pick(sample, CONFIG.nameColumns),
  stock: pick(sample, CONFIG.stockColumns),
  price: pick(sample, CONFIG.priceColumns),
  min:   pick(sample, CONFIG.minColumns),
  store: pick(sample, CONFIG.storeColumns),
};

const matches = (q) => {
  const needle = q.toLowerCase();
  return stockRows.filter(r => {
    const sku = String(r[COL.sku] ?? '').toLowerCase();
    const name = COL.name ? String(r[COL.name] ?? '').toLowerCase() : '';
    return sku === needle || sku.includes(needle) || name.includes(needle);
  });
};

const describe = (r) => {
  const parts = [String(r[COL.sku]).trim()];
  if (COL.name) parts.push(String(r[COL.name]).trim());
  if (COL.store) parts.push('[' + String(r[COL.store]).trim() + ']');
  if (COL.stock) parts.push('stock ' + num(r[COL.stock]));
  if (COL.price) parts.push(clp(num(r[COL.price])));
  return '  ' + parts.join(' | ');
};

const HELP = [
  'Comandos disponibles:',
  '  /inventario <sku o nombre>  - stock actual por local',
  '  /precio <sku o nombre>      - precio de lista',
  '  /bajos                      - productos bajo el minimo',
  '  /resumen                    - totales por local',
  '  /ayuda                      - esta lista',
  '',
  'Para registrar el conteo del dia, responder con una linea por producto:',
  '  SKU cantidad',
].join('\\n');

// ---- count replies ----------------------------------------------------------
// A message that is not a command but looks like "SKU cantidad" lines is the store
// reporting its physical count. Parse it here; the rows get written to the Data
// Table and Flow A picks them up as the conteo source the next morning.
function parseCountReply(raw) {
  const lines = raw.split(/\\r?\\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const rows = [];
  const bad = [];
  for (const line of lines) {
    // "7801 24", "7801: 24", "7801 - 24", "7801,24"
    const m = line.match(/^([A-Za-z0-9._\\-]+)\\s*[:,\\-]?\\s+(\\d+(?:[.,]\\d+)?)$/);
    if (!m) { bad.push(line); continue; }
    rows.push({ sku: key(m[1]), qty: num(m[2]) });
  }
  // Require the message to be mostly counts, so ordinary chat is not swallowed.
  if (!rows.length || bad.length > rows.length) return null;
  return { rows, bad };
}

let reply;

switch (cmd) {
  case '/start':
  case '/ayuda':
  case '/help':
    reply = HELP;
    break;

  case '/inventario': {
    if (!arg) { reply = 'Uso: /inventario <sku o nombre>'; break; }
    const hits = matches(arg);
    reply = hits.length
      ? 'Inventario para "' + arg + '":\\n' + hits.slice(0, 20).map(describe).join('\\n') +
        (hits.length > 20 ? '\\n  ... y ' + (hits.length - 20) + ' mas' : '')
      : 'No encontre nada para "' + arg + '".';
    break;
  }

  case '/precio': {
    if (!arg) { reply = 'Uso: /precio <sku o nombre>'; break; }
    if (!COL.price) { reply = 'El export no trae columna de precio.'; break; }
    const hits = matches(arg);
    reply = hits.length
      ? 'Precios para "' + arg + '":\\n' + hits.slice(0, 20).map(r =>
          '  ' + String(r[COL.sku]).trim() + ' ' +
          (COL.name ? String(r[COL.name]).trim() + ' ' : '') + clp(num(r[COL.price]))
        ).join('\\n')
      : 'No encontre nada para "' + arg + '".';
    break;
  }

  case '/bajos': {
    const low = stockRows.filter(r => {
      const s = num(r[COL.stock]);
      const min = COL.min ? (num(r[COL.min]) || CONFIG.minDefault) : CONFIG.minDefault;
      return s <= min;
    });
    low.sort((a, b) => num(a[COL.stock]) - num(b[COL.stock]));
    reply = low.length
      ? 'Bajo el minimo (' + low.length + '):\\n' + low.slice(0, 30).map(describe).join('\\n') +
        (low.length > 30 ? '\\n  ... y ' + (low.length - 30) + ' mas' : '')
      : 'Nada bajo el minimo.';
    break;
  }

  case '/resumen': {
    const totals = new Map();
    for (const r of stockRows) {
      const store = COL.store ? key(r[COL.store]) : 'TOTAL';
      const t = totals.get(store) ?? { skus: 0, units: 0, value: 0 };
      t.skus++;
      t.units += num(r[COL.stock]);
      if (COL.price) t.value += num(r[COL.stock]) * num(r[COL.price]);
      totals.set(store, t);
    }
    const lines = ['Resumen de inventario:'];
    for (const [store, t] of totals) {
      lines.push('  ' + store + ': ' + t.skus + ' SKUs, ' + t.units + ' unidades' +
                 (COL.price ? ', ' + clp(t.value) : ''));
    }
    reply = lines.join('\\n');
    break;
  }

  default: {
    if (text.startsWith('/')) {
      reply = 'No conozco el comando ' + cmd + '.\\n\\n' + HELP;
      break;
    }
    const parsed = parseCountReply(text);
    if (parsed) {
      const store = key(msg.chat?.title ?? '');
      const who = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
                  msg.from?.username || 'desconocido';
      const stamp = new Date().toISOString();

      // Resolve the store from the chat id when possible, so the count lands on the
      // right local even if the group title does not match CONFIG.stores.
      let resolved = store;
      for (const [nameKey, id] of Object.entries(CONFIG.stores)) {
        if (String(id) === String(chatId)) { resolved = nameKey; break; }
      }

      const known = new Set(stockRows.map(r => key(r[COL.sku])));
      const unknown = parsed.rows.filter(r => known.size && !known.has(r.sku));

      const lines = ['Conteo recibido: ' + parsed.rows.length + ' producto(s).'];
      parsed.rows.forEach(r => lines.push('  ' + r.sku + ' -> ' + r.qty));
      if (unknown.length) {
        lines.push('');
        lines.push('Ojo, estos SKU no estan en el stock: ' + unknown.map(r => r.sku).join(', '));
      }
      if (parsed.bad.length) {
        lines.push('');
        lines.push('No pude leer estas lineas:');
        parsed.bad.forEach(b => lines.push('  ' + b));
      }
      lines.push('');
      lines.push('Queda guardado. La diferencia sale en el reporte de manana.');

      let confirm = lines.join('\\n');
      if (confirm.length > 3900) confirm = confirm.slice(0, 3890) + '\\n... (truncado)';

      // One item per row: the Data Table insert node maps these fields to columns
      // by name. chat_id / reply ride along so the confirmation can be sent after.
      return parsed.rows.map((r, i) => ({
        json: {
          is_count: true,
          sku: r.sku,
          store: resolved,
          qty: r.qty,
          counted_at: stamp,
          reported_by: who,
          chat_id: chatId,
          reply: i === 0 ? confirm : '',
        },
      }));
    }
    reply = HELP;
  }
}

if (reply.length > 3900) reply = reply.slice(0, 3890) + '\\n... (truncado)';

return [{ json: { is_count: false, chat_id: chatId, command: cmd, arg, reply } }];
`;

// ---------------------------------------------------------------------------
// Flow A — heartbeat. If the VM is down nothing runs, so no error fires and the
// silence looks like "no problems". This is the daily proof of life: when it stops
// arriving, something is wrong even though no alert was raised.
// ---------------------------------------------------------------------------
const HEARTBEAT = `${CONFIG}

const OWNER_CHAT_ID = 'REPLACE_OWNER_CHAT_ID';

const reports = $('Calc core').all().map(i => i.json);
const when = new Date().toLocaleString('es-CL');

const totals = reports.reduce((a, r) => ({
  variances: a.variances + r.counts.variances,
  reorders: a.reorders + r.counts.reorders,
  lost: a.lost + r.counts.lost_value,
  counted: a.counted + r.counts.counted,
}), { variances: 0, reorders: 0, lost: 0, counted: 0 });

const lines = [
  'Motor de inventario OK - ' + when,
  '',
  'Locales procesados: ' + reports.length,
  'Productos contados: ' + totals.counted +
    ' (' + (reports[0]?.count_source === 'data_table' ? 'via Telegram' : 'via conteo.csv') + ')',
  'Diferencias: ' + totals.variances + ' (' + clp(totals.lost) + ')',
  'Reposiciones: ' + totals.reorders,
  '',
  'Si un dia no llega este mensaje, la automatizacion no corrio.',
];

return [{ json: { chat_id: OWNER_CHAT_ID, report: lines.join('\\n') } }];
`;

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------
const FOLDER_PLACEHOLDER = 'REPLACE_WITH_DRIVE_FOLDER_ID';

// The n8n Data Table that stores physical counts replied over Telegram.
// Created on the live instance 2026-08-03; recreate with the same columns if lost.
const COUNTS_TABLE_ID = 'ZWzp8b3WkpfVMbGh';

function dataTableInsert(name, pos) {
  return {
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: COUNTS_TABLE_ID },
      // autoMapInputData: whatever fields the previous Code node emits are matched
      // to columns by name, so the schema lives in one place (the Code node).
      columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: [], schema: [] },
      options: {},
    },
    id: `dt-${name.replace(/\W/g, '-')}`,
    name,
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: pos,
  };
}

function dataTableGetAll(name, pos) {
  return {
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: COUNTS_TABLE_ID },
      matchType: 'anyCondition',
      filters: { conditions: [] },
      returnAll: true,
      options: {},
    },
    id: `dt-${name.replace(/\W/g, '-')}`,
    name,
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: pos,
    // If the table read fails, Flow A still runs off conteo.csv.
    ...RESILIENT,
  };
}

// Drive can be flaky and a missing conteo.csv must not stall the whole run, so
// every fetch node retries, then degrades to an empty item instead of throwing.
// The Code nodes filter empty items out; only a missing stock.csv is fatal.
const RESILIENT = {
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 2000,
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
};

function driveSearch(name, fileName, pos) {
  return {
    parameters: {
      resource: 'fileFolder',
      queryString: fileName,
      filter: {
        folderId: { __rl: true, mode: 'id', value: FOLDER_PLACEHOLDER },
      },
      options: {},
    },
    id: `find-${fileName.replace(/\W/g, '-')}`,
    name,
    type: 'n8n-nodes-base.googleDrive',
    typeVersion: 3,
    position: pos,
    ...RESILIENT,
  };
}

function driveDownload(name, sourceNode, pos) {
  return {
    parameters: {
      operation: 'download',
      fileId: { __rl: true, mode: 'id', value: '={{ $json.id }}' },
      options: { binaryPropertyName: 'data' },
    },
    id: `dl-${name.replace(/\W/g, '-')}`,
    name,
    type: 'n8n-nodes-base.googleDrive',
    typeVersion: 3,
    position: pos,
    ...RESILIENT,
  };
}

function csvExtract(name, pos) {
  return {
    parameters: {
      operation: 'csv',
      binaryPropertyName: 'data',
      options: { delimiter: ';', headerRow: true },
    },
    id: `csv-${name.replace(/\W/g, '-')}`,
    name,
    type: 'n8n-nodes-base.extractFromFile',
    typeVersion: 1,
    position: pos,
    ...RESILIENT,
  };
}

function codeNode(name, code, pos) {
  return {
    parameters: { mode: 'runOnceForAllItems', jsCode: code },
    id: `code-${name.replace(/\W/g, '-')}`,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: pos,
  };
}

function telegramSend(name, pos) {
  return {
    parameters: {
      chatId: '={{ $json.chat_id }}',
      text: '={{ $json.report }}',
      additionalFields: { appendAttribution: false },
    },
    id: `tg-${name.replace(/\W/g, '-')}`,
    name,
    type: 'n8n-nodes-base.telegram',
    typeVersion: 1.2,
    position: pos,
    webhookId: undefined,
  };
}

function sticky(content, pos, size, color = 4) {
  return {
    parameters: { content, height: size[1], width: size[0], color },
    id: `note-${Math.random().toString(36).slice(2, 10)}`,
    name: `Note ${Math.random().toString(36).slice(2, 6)}`,
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: pos,
  };
}

// ---------------------------------------------------------------------------
// Flow A
// ---------------------------------------------------------------------------
function buildFlowA() {
  const nodes = [
    {
      parameters: { rule: { interval: [{ triggerAtHour: 9, triggerAtMinute: 0 }] } },
      id: 'schedule-daily',
      name: 'Schedule daily 09:00',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-820, 300],
    },

    driveSearch('Find stock.csv', 'stock.csv', [-600, 60]),
    driveDownload('Get stock.csv', 'Find stock.csv', [-380, 60]),
    csvExtract('CSV stock', [-160, 60]),

    driveSearch('Find ventas.csv', 'ventas.csv', [-600, 300]),
    driveDownload('Get ventas.csv', 'Find ventas.csv', [-380, 300]),
    csvExtract('CSV ventas', [-160, 300]),

    driveSearch('Find conteo.csv', 'conteo.csv', [-600, 540]),
    driveDownload('Get conteo.csv', 'Find conteo.csv', [-380, 540]),
    csvExtract('CSV conteo', [-160, 540]),

    dataTableGetAll('Get counts', [-380, 780]),

    {
      parameters: { numberInputs: 4 },
      id: 'merge-all',
      name: 'Wait for all inputs',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3,
      position: [80, 300],
    },

    codeNode('Calc core', CALC_CORE, [300, 180]),
    codeNode('Cycle count dispatch', CYCLE_COUNT, [300, 460]),

    telegramSend('Telegram report per store', [540, 180]),
    telegramSend('Telegram cycle count', [540, 460]),

    codeNode('Heartbeat', HEARTBEAT, [780, 180]),
    telegramSend('Telegram heartbeat', [1000, 180]),

    sticky(
      '## Before this runs\n\n1. Set the Google Drive **folder id** in the three "Find ..." nodes.\n2. Open **Calc core**, **Cycle count dispatch** and **Heartbeat** and edit the `CONFIG` block at the top:\n   - real Telegram chat ids per store\n   - `OWNER_CHAT_ID` in **Heartbeat** (your own chat)\n   - the real SKU column name (add it first in `skuColumns`)\n3. Attach the Google Drive and Telegram credentials.\n4. Check the CSV **delimiter** in the three "CSV ..." nodes — ControlVentas exports are usually `;`.\n\n**Counts:** the `conteos` Data Table is the primary source — stores fill it by replying to the cycle-count message in Telegram (Flow B). `conteo.csv` is only the fallback when the table is empty.',
      [-830, -280], [520, 520], 3
    ),
    sticky(
      '## AI agent goes here\n\nThe Code nodes already emit a finished plain-text `report`.\nWhen you want the AI to rewrite it, insert an AI Agent node between\n**Calc core** and **Telegram**, feed it `{{ $json.report }}`, and map the\nagent output to the Telegram `text` field.\n\nThe AI must never touch the numbers — it only rewrites wording.',
      [300, -220], [460, 300], 5
    ),
  ];

  const connections = {
    'Schedule daily 09:00': {
      main: [[
        { node: 'Find stock.csv', type: 'main', index: 0 },
        { node: 'Find ventas.csv', type: 'main', index: 0 },
        { node: 'Find conteo.csv', type: 'main', index: 0 },
        { node: 'Get counts', type: 'main', index: 0 },
      ]],
    },
    'Get counts': { main: [[{ node: 'Wait for all inputs', type: 'main', index: 3 }]] },
    'Find stock.csv': { main: [[{ node: 'Get stock.csv', type: 'main', index: 0 }]] },
    'Get stock.csv': { main: [[{ node: 'CSV stock', type: 'main', index: 0 }]] },
    'CSV stock': { main: [[{ node: 'Wait for all inputs', type: 'main', index: 0 }]] },

    'Find ventas.csv': { main: [[{ node: 'Get ventas.csv', type: 'main', index: 0 }]] },
    'Get ventas.csv': { main: [[{ node: 'CSV ventas', type: 'main', index: 0 }]] },
    'CSV ventas': { main: [[{ node: 'Wait for all inputs', type: 'main', index: 1 }]] },

    'Find conteo.csv': { main: [[{ node: 'Get conteo.csv', type: 'main', index: 0 }]] },
    'Get conteo.csv': { main: [[{ node: 'CSV conteo', type: 'main', index: 0 }]] },
    'CSV conteo': { main: [[{ node: 'Wait for all inputs', type: 'main', index: 2 }]] },

    'Wait for all inputs': {
      main: [[
        { node: 'Calc core', type: 'main', index: 0 },
        { node: 'Cycle count dispatch', type: 'main', index: 0 },
      ]],
    },
    'Calc core': { main: [[{ node: 'Telegram report per store', type: 'main', index: 0 }]] },
    'Cycle count dispatch': { main: [[{ node: 'Telegram cycle count', type: 'main', index: 0 }]] },
    // Heartbeat fires only after the store reports actually went out.
    'Telegram report per store': { main: [[{ node: 'Heartbeat', type: 'main', index: 0 }]] },
    'Heartbeat': { main: [[{ node: 'Telegram heartbeat', type: 'main', index: 0 }]] },
  };

  return {
    name: 'Tessa — Flow A — Daily inventory engine',
    nodes,
    connections,
    settings: { executionOrder: 'v1' },
    pinData: {},
  };
}

// ---------------------------------------------------------------------------
// Flow B
// ---------------------------------------------------------------------------
function buildFlowB() {
  const nodes = [
    {
      parameters: { updates: ['message'], additionalFields: {} },
      id: 'tg-trigger',
      name: 'Telegram trigger',
      type: 'n8n-nodes-base.telegramTrigger',
      typeVersion: 1.1,
      position: [-620, 300],
      webhookId: 'tessa-telegram-commands',
    },
    driveSearch('Find stock.csv', 'stock.csv', [-400, 300]),
    driveDownload('Get stock.csv', 'Find stock.csv', [-180, 300]),
    csvExtract('CSV stock', [40, 300]),
    codeNode('Command router', COMMAND_ROUTER, [260, 300]),
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{
            id: 'is-count',
            leftValue: '={{ $json.is_count }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          }],
          combinator: 'and',
        },
        looseTypeValidation: true,
        options: {},
      },
      id: 'if-count',
      name: 'Is a count reply?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [480, 300],
    },
    dataTableInsert('Save counts', [700, 180]),
    codeNode('One confirmation', `
// The insert node emits one item per saved row; collapse back to a single
// confirmation so the store gets one message, not one per product.
const items = $input.all().map(i => i.json);
const first = $('Command router').all().map(i => i.json).find(r => r.reply);
return [{ json: { chat_id: first?.chat_id, reply: first?.reply ?? ('Conteo guardado: ' + items.length + ' producto(s).') } }];
`, [920, 180]),
    {
      parameters: {
        chatId: '={{ $json.chat_id }}',
        text: '={{ $json.reply }}',
        additionalFields: { appendAttribution: false },
      },
      id: 'tg-reply',
      name: 'Telegram reply',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [1140, 300],
    },
    sticky(
      '## Flow B — command listener\n\nCommands:\n`/inventario <sku>` `/precio <sku>` `/bajos` `/resumen` `/ayuda`\n\n**Count replies:** any non-command message shaped like\n`SKU cantidad` (one per line) is saved to the **conteos**\nData Table and confirmed back. Flow A reads that table as\nthe conteo source, so nobody re-types counts by hand.\n\nSame setup as Flow A: Drive folder id in "Find stock.csv",\nand the `CONFIG` block inside **Command router**.\n\nThis flow must be **activated** (toggle top right) for the\nTelegram webhook to register.',
      [-630, -140], [520, 380], 6
    ),
  ];

  const connections = {
    'Telegram trigger': { main: [[{ node: 'Find stock.csv', type: 'main', index: 0 }]] },
    'Find stock.csv': { main: [[{ node: 'Get stock.csv', type: 'main', index: 0 }]] },
    'Get stock.csv': { main: [[{ node: 'CSV stock', type: 'main', index: 0 }]] },
    'CSV stock': { main: [[{ node: 'Command router', type: 'main', index: 0 }]] },
    'Command router': { main: [[{ node: 'Is a count reply?', type: 'main', index: 0 }]] },
    // true -> save to the Data Table, then confirm; false -> answer directly.
    'Is a count reply?': {
      main: [
        [{ node: 'Save counts', type: 'main', index: 0 }],
        [{ node: 'Telegram reply', type: 'main', index: 0 }],
      ],
    },
    'Save counts': { main: [[{ node: 'One confirmation', type: 'main', index: 0 }]] },
    'One confirmation': { main: [[{ node: 'Telegram reply', type: 'main', index: 0 }]] },
  };

  return {
    name: 'Tessa — Flow B — Telegram commands',
    nodes,
    connections,
    settings: { executionOrder: 'v1' },
    pinData: {},
  };
}

// ---------------------------------------------------------------------------
// Flow C — error alerts (Phase 6). Set as the "Error Workflow" on A and B, so a
// silent overnight failure reaches the owner instead of dying in the log.
// ---------------------------------------------------------------------------
const ERROR_FORMATTER = `
// Owner's Telegram chat id — where failures get reported.
const OWNER_CHAT_ID = 'REPLACE_OWNER_CHAT_ID';

const e = $json.execution ?? {};
const w = $json.workflow ?? {};
const err = e.error ?? {};

const when = new Date(e.startedAt ?? Date.now()).toLocaleString('es-CL');

const lines = [
  'FALLO EN LA AUTOMATIZACION',
  '',
  'Workflow: ' + (w.name ?? 'desconocido'),
  'Cuando: ' + when,
];
if (err.node?.name) lines.push('Nodo: ' + err.node.name);
lines.push('Error: ' + (err.message ?? 'sin mensaje'));
if (e.url) {
  lines.push('');
  lines.push('Ver ejecucion: ' + e.url);
}
lines.push('');
lines.push('El reporte de hoy puede no haberse enviado. Revisar antes de abrir.');

let report = lines.join('\\n');
if (report.length > 3900) report = report.slice(0, 3890) + '\\n... (truncado)';

return [{ json: { chat_id: OWNER_CHAT_ID, report } }];
`;

function buildFlowC() {
  const nodes = [
    {
      parameters: {},
      id: 'error-trigger',
      name: 'On workflow error',
      type: 'n8n-nodes-base.errorTrigger',
      typeVersion: 1,
      position: [-400, 300],
    },
    codeNode('Format the alert', ERROR_FORMATTER, [-160, 300]),
    telegramSend('Telegram alert owner', [80, 300]),
    sticky(
      '## Flow C — error alerts\n\nSet `OWNER_CHAT_ID` inside **Format the alert**.\n\nThen open Flow A and Flow B -> **Settings** -> **Error Workflow** ->\npick this workflow. Without that wiring this never fires.\n\nDo not set this workflow as its own error workflow — a failure here\nwould loop.',
      [-410, 20], [520, 250], 2
    ),
  ];

  const connections = {
    'On workflow error': { main: [[{ node: 'Format the alert', type: 'main', index: 0 }]] },
    'Format the alert': { main: [[{ node: 'Telegram alert owner', type: 'main', index: 0 }]] },
  };

  return {
    name: 'Tessa — Flow C — Error alerts',
    nodes,
    connections,
    settings: { executionOrder: 'v1' },
    pinData: {},
  };
}

// ---------------------------------------------------------------------------
const outDir = __dirname;
const targets = [
  ['flow-a-daily-engine.workflow.json', buildFlowA()],
  ['flow-b-telegram-commands.workflow.json', buildFlowB()],
  ['flow-c-error-alerts.workflow.json', buildFlowC()],
];

for (const [file, wf] of targets) {
  const dest = path.join(outDir, file);
  fs.writeFileSync(dest, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  console.log('wrote ' + file + ' (' + wf.nodes.length + ' nodes)');
}
