// ===========================================================================
// Generates flow-a-v2-two-stores.workflow.json
//
// One independent branch per ACTIVE store, so a bad export in one store can
// never take the other one down. Red and White is warehouse-only and has no
// branch — its Drive folder exists but stays empty by design.
//
//   Schedule ─┬─ [Tengo Sed]  find inv -> download -> xlsx ─┐
//             │                find ventas -> download -> csv ─┤-> Calc -> Telegram
//             └─ [Los Negros] find inv -> download -> xlsx ─┐
//                              find ventas -> download -> csv ─┤-> Calc -> Telegram
//
// Run: node build-flow-a-v2.js
// ===========================================================================
const fs = require('fs');
const path = require('path');

// The calc core is embedded once per Code node (3x in this flow). With full
// comments the workflow JSON grew past ~140 KB, which the n8n canvas silently
// refuses to paste. Comments live in the repo; the embedded copy is stripped.
const CALC_SOURCE = fs.readFileSync(path.join(__dirname, 'calc-core-v2.js'), 'utf8')
  // strip the CommonJS export tail — n8n Code nodes have no `module`
  .replace(/\n\/\/ Exported for the test harness[\s\S]*$/, '\n')
  .split('\n')
  .filter(l => !/^\s*\/\//.test(l))
  .join('\n')
  .replace(/\n{2,}/g, '\n');

// HOUSE RULE for the whole agent team: messages are paced, never batched.
const MESSAGE_GAP_SECONDS = 10;

const STORES = [
  { name: 'Tengo Sed',  slug: 'ts', folderId: '17LKTSeQCB1ZYdi8OdlpJNEjR8SbheBQs' },
  { name: 'Los Negros', slug: 'ln', folderId: '1BfjcRpN18hkUCTy9VvwU6nn6KAkTmU-4' },
];

const nodes = [];
const connections = {};

function connect(from, to, outIdx = 0) {
  connections[from] = connections[from] || { main: [] };
  while (connections[from].main.length <= outIdx) connections[from].main.push([]);
  connections[from].main[outIdx].push({ node: to, type: 'main', index: 0 });
}

// --- trigger ---------------------------------------------------------------
// Sunday(0) through Friday(5) at 09:00 — Saturday is the store's day off, so
// the cron simply never fires then. calc-core's workingDayIndex keeps the
// product walk contiguous across the gap.
nodes.push({
  parameters: { rule: { interval: [{ field: 'cronExpression', expression: '30 12 * * 0-5' }] } },
  id: 'trg-schedule', name: 'Dom a Vie 12:30',
  type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [-680, 400],
});
nodes.push({
  parameters: {}, id: 'trg-manual', name: 'Ejecutar manualmente',
  type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-680, 620],
});

// All replies the stores have sent so far. A product stays in the daily batch
// until a row for it shows up here.
nodes.push({
  parameters: {
    resource: 'row', operation: 'get',
    dataTableId: { __rl: true, mode: 'id', value: 'ZWzp8b3WkpfVMbGh' },
    matchType: 'anyCondition', filters: { conditions: [] },
    returnAll: true, options: {},
  },
  id: 'get-conteos', name: 'Conteos recibidos',
  type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [-460, 500],
  alwaysOutputData: true, onError: 'continueRegularOutput',
});

const DRIVE_CRED = { googleDriveOAuth2Api: { id: 'CDibYBClrFaZqq15', name: 'Google Drive account' } };

// Drive search returns files newest-first; we take the first match only, so a
// new export simply supersedes the previous one with no renaming discipline.
function driveSearch(id, name, pos, folderId, pattern) {
  return {
    parameters: {
      resource: 'fileFolder',
      queryString: pattern,
      filter: { folderId: { __rl: true, value: folderId, mode: 'id' } },
      returnAll: false, limit: 1,
      options: { fields: ['id', 'name', 'modifiedTime'], orderBy: [{ key: 'modifiedTime', value: 'desc' }] },
    },
    id, name, type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: pos,
    credentials: DRIVE_CRED,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    alwaysOutputData: true,
  };
}

function driveDownload(id, name, pos) {
  return {
    parameters: {
      operation: 'download',
      fileId: { __rl: true, value: '={{ $json.id }}', mode: 'id' },
      options: { binaryPropertyName: 'data' },
    },
    id, name, type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: pos,
    credentials: DRIVE_CRED,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
    alwaysOutputData: true,
  };
}

function extractXlsx(id, name, pos) {
  return {
    parameters: { operation: 'xlsx', binaryPropertyName: 'data', options: { headerRow: true } },
    id, name, type: 'n8n-nodes-base.extractFromFile', typeVersion: 1, position: pos,
    alwaysOutputData: true, onError: 'continueRegularOutput',
  };
}

function extractCsv(id, name, pos) {
  return {
    parameters: {
      operation: 'csv', binaryPropertyName: 'data',
      // ControlVentas exports are semicolon-delimited UTF-8 with a BOM.
      options: { delimiter: ';', encoding: 'utf8', headerRow: true },
    },
    id, name, type: 'n8n-nodes-base.extractFromFile', typeVersion: 1, position: pos,
    alwaysOutputData: true, onError: 'continueRegularOutput',
  };
}

let y = 100;
for (const st of STORES) {
  const P = st.slug;
  const findInv = `Buscar inventario — ${st.name}`;
  const dlInv   = `Bajar inventario — ${st.name}`;
  const xInv    = `Leer xlsx — ${st.name}`;
  const findVen = `Buscar ventas — ${st.name}`;
  const dlVen   = `Bajar ventas — ${st.name}`;
  const xVen    = `Leer csv — ${st.name}`;
  const merge   = `Esperar ambos — ${st.name}`;
  const calc    = `Calc core — ${st.name}`;
  const tg      = `Telegram — ${st.name}`;

  nodes.push(driveSearch(`${P}-f-inv`, findInv, [-160, y], st.folderId, 'invent'));
  nodes.push(driveDownload(`${P}-d-inv`, dlInv, [60, y]));
  nodes.push(extractXlsx(`${P}-x-inv`, xInv, [280, y]));

  nodes.push(driveSearch(`${P}-f-ven`, findVen, [-160, y + 180], st.folderId, 'venta'));
  nodes.push(driveDownload(`${P}-d-ven`, dlVen, [60, y + 180]));
  nodes.push(extractCsv(`${P}-x-ven`, xVen, [280, y + 180]));

  // Merge purely as a barrier: guarantees both files are read before the math.
  nodes.push({
    parameters: { mode: 'chooseBranch', useDataOfInput: 1, numberInputs: 2 },
    id: `${P}-merge`, name: merge,
    type: 'n8n-nodes-base.merge', typeVersion: 3, position: [500, y + 90],
  });

  nodes.push({
    parameters: {
      jsCode: `${CALC_SOURCE}
// ---- n8n wiring ----------------------------------------------------------
const STORE = ${JSON.stringify(st.name)};

function rowsOf(nodeName) {
  try {
    return $(nodeName).all().map(i => i.json).filter(r => r && Object.keys(r).length);
  } catch (e) { return []; }
}

const invRows = rowsOf(${JSON.stringify(xInv)});
const salesRows = rowsOf(${JSON.stringify(xVen)});

// Replies from the 'conteos' Data Table, narrowed to this store. A missing or
// empty table is fine: it just means nothing has been answered yet.
const countRows = rowsOf('Conteos recibidos')
  .filter(r => !r.store || String(r.store).trim() === STORE);

// Which products are currently outstanding, and how far through the catalogue
// this store has walked. Persisted on the workflow so an unanswered batch is
// re-sent unchanged tomorrow instead of being replaced by new products.
const store = $getWorkflowStaticData('global');
store.batches = store.batches || {};
const prevState = store.batches[STORE];

// modifiedTime of the newest file found in this store's Uploads folder, used to
// nag when nobody has exported from ControlVentas for a while.
function newestModified(nodeName) {
  try {
    const it = $(nodeName).first();
    return (it && it.json && (it.json.modifiedTime || it.json.modified_time)) || null;
  } catch (e) { return null; }
}

const files = {
  inventory: newestModified(${JSON.stringify(findInv)}),
  ventas: newestModified(${JSON.stringify(findVen)}),
};

const result = calcStore(STORE, invRows, salesRows, countRows, prevState, files);
store.batches[STORE] = result.nextState;
// carried so the 17:30 branch can repeat the upload nag without re-reading Drive
store.batches[STORE].filesTask = result.filesTask;

result.chatId = CONFIG.stores[STORE] ? CONFIG.stores[STORE].chatId : CONFIG.ownerChatId;
return [{ json: result }];`,
    },
    id: `${P}-calc`, name: calc,
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [720, y + 90],
  });

  // Three messages per store, chained so they always arrive in this order:
  // resumen -> ajuste de negativos (10) -> conteo del dia (5).
  const tgNeg = `Ajuste negativos — ${st.name}`;
  const tgCnt = `Conteo del dia — ${st.name}`;

  const telegramNode = (id, name, field, pos) => ({
    parameters: {
      chatId: `={{ $('${calc}').first().json.chatId }}`,
      text: `={{ $('${calc}').first().json.${field} }}`,
      additionalFields: { appendAttribution: false },
    },
    id, name,
    type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: pos,
    credentials: { telegramApi: { id: 'F6I0NPw13xUehqey', name: 'Telegram account' } },
    onError: 'continueRegularOutput',
  });

  // HOUSE RULE: never fire messages back-to-back. Each one gets 10s of air so
  // the store can actually read it and Telegram never rate-limits the group.
  const wait = (id, name, pos) => ({
    parameters: { amount: MESSAGE_GAP_SECONDS, unit: 'seconds' },
    id, name, type: 'n8n-nodes-base.wait', typeVersion: 1.1,
    position: pos, webhookId: id,
  });

  const wait1 = `Esperar 10s — ${st.name} (1)`;
  const wait2 = `Esperar 10s — ${st.name} (2)`;

  nodes.push(telegramNode(`${P}-tg`, tg, 'report', [940, y + 90]));
  nodes.push(wait(`${P}-w1`, wait1, [1120, y + 90]));
  nodes.push(telegramNode(`${P}-tg-neg`, tgNeg, 'negativesTask', [1300, y + 90]));
  nodes.push(wait(`${P}-w2`, wait2, [1480, y + 90]));
  nodes.push(telegramNode(`${P}-tg-cnt`, tgCnt, 'countTask', [1660, y + 90]));

  for (const trg of ['Dom a Vie 12:30', 'Ejecutar manualmente']) {
    connect(trg, findInv);
    connect(trg, findVen);
    connect(trg, 'Conteos recibidos');
  }
  connect(findInv, dlInv);
  connect(dlInv, xInv);
  connect(xInv, merge, 0);
  connect(findVen, dlVen);
  connect(dlVen, xVen);
  connect(xVen, merge, 0);
  connections[xVen].main[0] = [{ node: merge, type: 'main', index: 1 }];
  connect(merge, calc);
  connect(calc, tg);
  connect(tg, wait1);
  connect(wait1, tgNeg);
  connect(tgNeg, wait2);
  connect(wait2, tgCnt);

  y += 420;
}

// --- 17:30 reminder --------------------------------------------------------
// Deliberately does NOT re-run the calc. It reads the batch already stored on
// the workflow and removes whatever has since been answered, so a reminder can
// never hand out new products or move the cursor. If both stores have replied
// in full the Code node emits nothing and no message is sent.
nodes.push({
  parameters: { rule: { interval: [{ field: 'cronExpression', expression: '30 17 * * 0-5' }] } },
  id: 'trg-remind', name: 'Recordatorio 17:30',
  type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [-680, 1180],
});

nodes.push({
  parameters: {
    resource: 'row', operation: 'get',
    dataTableId: { __rl: true, mode: 'id', value: 'ZWzp8b3WkpfVMbGh' },
    matchType: 'anyCondition', filters: { conditions: [] },
    returnAll: true, options: {},
  },
  id: 'remind-conteos', name: 'Conteos para recordatorio',
  type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [-460, 1180],
  alwaysOutputData: true, onError: 'continueRegularOutput',
});

nodes.push({
  parameters: {
    jsCode: `${CALC_SOURCE}
// ---- n8n wiring ----------------------------------------------------------
const rows = (() => {
  try { return $('Conteos para recordatorio').all().map(i => i.json).filter(r => r && Object.keys(r).length); }
  catch (e) { return []; }
})();

const store = $getWorkflowStaticData('global');
const batches = store.batches || {};
const out = [];

for (const name of Object.keys(CONFIG.stores)) {
  const st = batches[name];
  if (!st) continue;

  const answered = new Set();
  for (const r of rows) {
    if (r.store && String(r.store).trim() !== name) continue;
    const sku = r.sku !== undefined ? r.sku : r.SKU;
    for (const k of keysOf(sku)) answered.add(k);
  }

  const negOpen = outstandingFrom(st.negatives, answered);
  const cntOpen = outstandingFrom(st.count, answered);
  const parts = [];

  const text = buildReminder(name, negOpen, cntOpen);
  if (text) parts.push(text);

  // Re-nag about stale exports in the afternoon too — by 17:30 there is still
  // time to upload today's file before tomorrow's 12:30 run.
  if (st.filesTask) parts.push(st.filesTask);

  for (const t of parts) {
    out.push({ json: { store: name, chatId: CONFIG.stores[name].chatId, text: t,
                       pendingNegatives: negOpen.length, pendingCount: cntOpen.length } });
  }
}

// Empty output = everyone answered = no reminder sent.
return out;`,
  },
  id: 'remind-calc', name: 'Que falta responder',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [-240, 1180],
});

nodes.push({
  parameters: {
    chatId: '={{ $json.chatId }}',
    text: '={{ $json.text }}',
    additionalFields: { appendAttribution: false },
  },
  id: 'remind-tg', name: 'Telegram recordatorio',
  type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [-20, 1180],
  credentials: { telegramApi: { id: 'F6I0NPw13xUehqey', name: 'Telegram account' } },
  onError: 'continueRegularOutput',
});

connect('Recordatorio 17:30', 'Conteos para recordatorio');
connect('Conteos para recordatorio', 'Que falta responder');
connect('Que falta responder', 'Telegram recordatorio');

// --- sticky note -----------------------------------------------------------
nodes.push({
  parameters: {
    content: [
      '## Flow A v2 — dos locales',
      '',
      'Un ramo independiente por local. Si falla un archivo de un local,',
      'el otro igual manda su reporte.',
      '',
      '**Red and White NO tiene ramo** — es solo bodega. Su carpeta en Drive',
      'existe pero queda vacia a proposito.',
      '',
      'Cada local recibe 3 mensajes a las 12:30: resumen, ajuste de negativos (8)',
      'y conteo del dia (8). Domingo a viernes — sabado NO.',
      '',
      'A las 17:30 sale un RECORDATORIO solo con lo que quedo sin responder.',
      'Si el local ya respondio todo, no se manda nada.',
      '',
      'Los 8 productos se REPITEN hasta que el local responda "SKU cantidad".',
      'Recien cuando responden todos pasa a los 8 siguientes. Orden alfabetico',
      'por nombre (los "120 ..." quedan en su letra, no todos al principio).',
      '',
      'Chat ids y credenciales YA configurados y probados (2026-08-03).',
      'Ojo: son los ids de SUPERGRUPO (-100...), no los que salen en el mensaje.',
      '',
      'CONFIG.periodDays = 3: los export de ControlVentas se suben a Drive',
      'cada 3 dias, asi que cada archivo trae 3 dias de venta. Si cambia esa',
      'frecuencia hay que cambiar este numero — de el salen todas las',
      'cantidades a pedir.',
    ].join('\n'),
    height: 540, width: 470, color: 4,
  },
  id: 'note-1', name: 'Leeme',
  type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [-460, 860],
});

const wf = {
  name: 'Flow A v2 — Inventario 2 locales',
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

const out = path.join(__dirname, 'flow-a-v2-two-stores.workflow.json');
fs.writeFileSync(out, JSON.stringify(wf, null, 2), 'utf8');
console.log('wrote ' + out);
console.log('  nodes: ' + nodes.length + '  stores: ' + STORES.map(s => s.name).join(', '));
