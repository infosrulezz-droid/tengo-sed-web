// ===========================================================================
// Generates flow-b-v2-respuestas.workflow.json
//
// The listener half of the system. Flow A asks; this reads the answers.
//
//   Telegram trigger ─> Interpretar ─┬─> Split counts -> conteos Data Table
//   (message + photo)                ├─> [si hay foto] subir a Drive
//                                    └─> Telegram: confirmacion
//
// Accepts a plain text reply OR a photo whose caption carries the numbers.
// A photo with no caption is stored and the store is asked for the numbers —
// the agent never reads a quantity off an image.
//
// Run: node build-flow-b-v2.js
// ===========================================================================
const fs = require('fs');
const path = require('path');

// Comments stripped from the embedded copy — see the note in build-flow-a-v2.js.
const CALC_SOURCE = fs.readFileSync(path.join(__dirname, 'calc-core-v2.js'), 'utf8')
  .replace(/\n\/\/ Exported for the test harness[\s\S]*$/, '\n')
  .split('\n')
  .filter(l => !/^\s*\/\//.test(l))
  .join('\n')
  .replace(/\n{2,}/g, '\n');

const TELEGRAM_CRED = { telegramApi: { id: 'F6I0NPw13xUehqey', name: 'Telegram account' } };
const DRIVE_CRED = { googleDriveOAuth2Api: { id: 'CDibYBClrFaZqq15', name: 'Google Drive account' } };
const CONTEOS_TABLE = 'ZWzp8b3WkpfVMbGh';

// Photos go in the STORE folder, never in Uploads — Flow A scans Uploads for
// the newest inventory/ventas export and a photo there would be noise.
const PHOTO_FOLDER = {
  'Tengo Sed': '1iJ83Ky9XZn7327yo0thoU5rvvLwrK4w_',
  'Los Negros': '1H2_T5i9hzgMqMEGvppVV1k6LsC2U2Yge',
};

const nodes = [];
const connections = {};
function connect(from, to, outIdx = 0) {
  connections[from] = connections[from] || { main: [] };
  while (connections[from].main.length <= outIdx) connections[from].main.push([]);
  connections[from].main[outIdx].push({ node: to, type: 'main', index: 0 });
}

// --- trigger ---------------------------------------------------------------
// download:true makes n8n fetch the photo binary for us, so no getFile dance.
nodes.push({
  parameters: { updates: ['message'], additionalFields: { download: true } },
  id: 'b-trigger', name: 'Telegram entrada',
  type: 'n8n-nodes-base.telegramTrigger', typeVersion: 1.2, position: [-600, 300],
  credentials: TELEGRAM_CRED, webhookId: 'tessa-flow-b-v2',
});

// --- interpret -------------------------------------------------------------
nodes.push({
  parameters: {
    jsCode: `${CALC_SOURCE}
// ---- n8n wiring ----------------------------------------------------------
const PHOTO_FOLDER = ${JSON.stringify(PHOTO_FOLDER)};

const UPLOADS = {
  'Tengo Sed': '17LKTSeQCB1ZYdi8OdlpJNEjR8SbheBQs',
  'Los Negros': '1BfjcRpN18hkUCTy9VvwU6nn6KAkTmU-4',
};

const msg = $json.message || $json.channel_post || {};
const chat = msg.chat || {};
const chatId = String(chat.id ?? '');

// Resolve the store from the chat id. Never infer it from an earlier message.
let store = null;
for (const name of Object.keys(CONFIG.stores)) {
  if (String(CONFIG.stores[name].chatId) === chatId) { store = name; break; }
}
const isOwner = chatId === String(CONFIG.ownerChatId);

// A photo arrives as message.photo[]; its text lives in .caption.
const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
const body = (msg.text || msg.caption || '').trim();

// Unknown chat: stay silent rather than replying into a stranger's chat.
if (!store && !isOwner) return [];

const base = {
  store: store,
  chatId: chatId,
  messageId: msg.message_id,
  from: (msg.from && (msg.from.first_name || msg.from.username)) || 'desconocido',
  hasPhoto: hasPhoto,
  text: body,
};

// A slash command is handled on its own branch: it needs the inventory file,
// which the count path does not.
const command = parseCommand(body);
if (command) {
  // The owner has no store folder of their own; default to Tengo Sed so
  // /stock still answers instead of erroring.
  const target = store || 'Tengo Sed';
  return [{ json: Object.assign({}, base, {
    action: 'COMMAND',
    store: target,
    command: command.cmd,
    args: command.args,
    uploadsFolder: UPLOADS[target],
    counts: [],
  }) }];
}

// Flow B cannot see Flow A's outstanding list (separate workflow, separate
// static data), so every SKU shaped like a code is accepted here and Flow A
// decides what it closes. Passing an empty set disables the known-SKU filter.
const parsed = parseCountReply(body, new Set());

if (!parsed.isCountReply) {
  if (hasPhoto) {
    // Photo with no usable caption: keep it, ask for the numbers.
    return [{ json: Object.assign({}, base, {
      action: 'PHOTO_NO_CAPTION',
      counts: [],
      reply: buildPhotoNeedsCaption(store || 'Local', []),
      photoName: 'conteo_' + (store || 'local').replace(/\\s+/g, '_') + '_' +
                 new Date().toISOString().replace(/[:.]/g, '-') + '.jpg',
      photoFolder: PHOTO_FOLDER[store] || null,
    }) }];
  }
  // Ordinary chat in the group: ignore it completely.
  return [];
}

const stamp = new Date().toISOString();
const counts = parsed.counts.concat(parsed.unknown).map(c => ({
  sku: c.sku,
  store: store || 'desconocido',
  qty: c.qty,
  counted_at: stamp,
  reported_by: base.from,
}));

return [{ json: Object.assign({}, base, {
  action: hasPhoto ? 'COUNT_WITH_PHOTO' : 'COUNT',
  counts: counts,
  reply: buildCountConfirmation(store || 'Local', parsed, [], hasPhoto),
  photoName: 'conteo_' + (store || 'local').replace(/\\s+/g, '_') + '_' +
             stamp.replace(/[:.]/g, '-') + '.jpg',
  photoFolder: PHOTO_FOLDER[store] || null,
}) }];`,
  },
  id: 'b-interpret', name: 'Interpretar mensaje',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [-380, 300],
});

// --- route: command vs count ----------------------------------------------
nodes.push({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{
        id: 'is-cmd',
        leftValue: '={{ $json.action }}',
        rightValue: 'COMMAND',
        operator: { type: 'string', operation: 'equals' },
      }],
      combinator: 'and',
    },
    options: {},
  },
  id: 'b-route', name: 'Es comando?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [-180, 300],
});

// --- command branch: read the store's files, then answer -------------------
const driveSearch = (id, name, pos, pattern) => ({
  parameters: {
    resource: 'fileFolder',
    queryString: pattern,
    filter: { folderId: { __rl: true, value: '={{ $json.uploadsFolder }}', mode: 'id' } },
    returnAll: false, limit: 1,
    options: { fields: ['id', 'name', 'modifiedTime'], orderBy: [{ key: 'modifiedTime', value: 'desc' }] },
  },
  id, name, type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: pos,
  credentials: DRIVE_CRED,
  retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, alwaysOutputData: true,
});

const driveDownload = (id, name, pos) => ({
  parameters: {
    operation: 'download',
    fileId: { __rl: true, value: '={{ $json.id }}', mode: 'id' },
    options: { binaryPropertyName: 'data' },
  },
  id, name, type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: pos,
  credentials: DRIVE_CRED,
  retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, alwaysOutputData: true,
});

nodes.push(driveSearch('b-c-finv', 'Buscar inventario (cmd)', [60, 60], 'invent'));
nodes.push(driveDownload('b-c-dinv', 'Bajar inventario (cmd)', [280, 60]));
nodes.push({
  parameters: { operation: 'xlsx', binaryPropertyName: 'data', options: { headerRow: true } },
  id: 'b-c-xinv', name: 'Leer xlsx (cmd)',
  type: 'n8n-nodes-base.extractFromFile', typeVersion: 1, position: [500, 60],
  alwaysOutputData: true, onError: 'continueRegularOutput',
});

nodes.push(driveSearch('b-c-fven', 'Buscar ventas (cmd)', [60, 240], 'venta'));
nodes.push(driveDownload('b-c-dven', 'Bajar ventas (cmd)', [280, 240]));
nodes.push({
  parameters: {
    operation: 'csv', binaryPropertyName: 'data',
    options: { delimiter: ';', encoding: 'utf8', headerRow: true },
  },
  id: 'b-c-xven', name: 'Leer csv (cmd)',
  type: 'n8n-nodes-base.extractFromFile', typeVersion: 1, position: [500, 240],
  alwaysOutputData: true, onError: 'continueRegularOutput',
});

nodes.push({
  parameters: { mode: 'chooseBranch', useDataOfInput: 1, numberInputs: 2 },
  id: 'b-c-merge', name: 'Esperar archivos (cmd)',
  type: 'n8n-nodes-base.merge', typeVersion: 3, position: [720, 150],
});

nodes.push({
  parameters: {
    jsCode: `${CALC_SOURCE}
// ---- n8n wiring ----------------------------------------------------------
const info = $('Interpretar mensaje').first().json;

function rowsOf(nodeName) {
  try { return $(nodeName).all().map(i => i.json).filter(r => r && Object.keys(r).length); }
  catch (e) { return []; }
}

let reply;
try {
  reply = answerCommand(info.store, info.command, info.args,
                        rowsOf('Leer xlsx (cmd)'), rowsOf('Leer csv (cmd)'));
} catch (e) {
  // Never leave a command unanswered — silence looks like the bot is dead.
  reply = 'No pude responder /' + info.command + ': ' + e.message;
}

return [{ json: { chatId: info.chatId, reply: reply, command: info.command } }];`,
  },
  id: 'b-c-answer', name: 'Responder comando',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [940, 150],
});

nodes.push({
  parameters: {
    chatId: '={{ $json.chatId }}',
    text: '={{ $json.reply }}',
    additionalFields: { appendAttribution: false },
  },
  id: 'b-c-tg', name: 'Enviar respuesta',
  type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [1160, 150],
  credentials: TELEGRAM_CRED, onError: 'continueRegularOutput',
});

// --- counts -> Data Table --------------------------------------------------
nodes.push({
  parameters: { fieldToSplitOut: 'counts', options: {} },
  id: 'b-split', name: 'Separar conteos',
  type: 'n8n-nodes-base.splitOut', typeVersion: 1, position: [-160, 140],
  alwaysOutputData: false, onError: 'continueRegularOutput',
});

nodes.push({
  parameters: {
    resource: 'row', operation: 'insert',
    dataTableId: { __rl: true, mode: 'id', value: CONTEOS_TABLE },
    columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: [], schema: [] },
    options: {},
  },
  id: 'b-save', name: 'Guardar en conteos',
  type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [60, 140],
  onError: 'continueRegularOutput',
});

// --- photo -> Drive --------------------------------------------------------
nodes.push({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{
        id: 'has-photo',
        leftValue: '={{ $json.hasPhoto }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      }],
      combinator: 'and',
    },
    options: {},
  },
  id: 'b-if-photo', name: 'Hay foto?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [-160, 340],
});

nodes.push({
  parameters: {
    name: '={{ $json.photoName }}',
    driveId: { __rl: true, mode: 'list', value: 'My Drive' },
    folderId: { __rl: true, mode: 'id', value: '={{ $json.photoFolder }}' },
    options: {},
  },
  id: 'b-drive', name: 'Guardar foto en Drive',
  type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: [60, 340],
  credentials: DRIVE_CRED,
  retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
  onError: 'continueRegularOutput',
});

// --- reply -----------------------------------------------------------------
nodes.push({
  parameters: {
    chatId: `={{ $('Interpretar mensaje').first().json.chatId }}`,
    text: `={{ $('Interpretar mensaje').first().json.reply }}`,
    additionalFields: { appendAttribution: false },
  },
  id: 'b-reply', name: 'Confirmar al local',
  type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [280, 340],
  credentials: TELEGRAM_CRED, onError: 'continueRegularOutput',
});

nodes.push({
  parameters: {
    content: [
      '## Flow B v2 — respuestas de los locales',
      '',
      'Escucha el grupo de cada local y guarda los conteos.',
      '',
      'Acepta:',
      '- Texto:  `7801620001643 22` (una linea por producto)',
      '- Foto CON pie de foto: se guarda la foto y se anotan los numeros',
      '- Foto SIN pie de foto: se guarda la foto y se pide el numero',
      '',
      'NUNCA lee cantidades desde la imagen. La foto es respaldo, no dato.',
      '',
      'El chat normal del grupo se ignora: un mensaje solo cuenta si la',
      'mitad o mas de sus lineas tienen forma "SKU cantidad".',
      '',
      'Las fotos van a la carpeta del local en Drive, NO a Uploads',
      '(Uploads es solo para los export de ControlVentas).',
    ].join('\n'),
    height: 420, width: 460, color: 5,
  },
  id: 'b-note', name: 'Leeme',
  type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [-600, 560],
});

connect('Telegram entrada', 'Interpretar mensaje');
connect('Interpretar mensaje', 'Es comando?');

// true -> command branch
connect('Es comando?', 'Buscar inventario (cmd)', 0);
connect('Es comando?', 'Buscar ventas (cmd)', 0);
connect('Buscar inventario (cmd)', 'Bajar inventario (cmd)');
connect('Bajar inventario (cmd)', 'Leer xlsx (cmd)');
connect('Leer xlsx (cmd)', 'Esperar archivos (cmd)', 0);
connect('Buscar ventas (cmd)', 'Bajar ventas (cmd)');
connect('Bajar ventas (cmd)', 'Leer csv (cmd)');
connect('Leer csv (cmd)', 'Esperar archivos (cmd)', 0);
connections['Leer csv (cmd)'].main[0] = [{ node: 'Esperar archivos (cmd)', type: 'main', index: 1 }];
connect('Esperar archivos (cmd)', 'Responder comando');
connect('Responder comando', 'Enviar respuesta');

// false -> count / photo branch
connect('Es comando?', 'Separar conteos', 1);
connect('Es comando?', 'Hay foto?', 1);
connect('Separar conteos', 'Guardar en conteos');
connect('Hay foto?', 'Guardar foto en Drive', 0);   // true
connect('Hay foto?', 'Confirmar al local', 1);      // false
connect('Guardar foto en Drive', 'Confirmar al local');

const wf = {
  name: 'Flow B v2 — Respuestas de locales',
  nodes, connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

const out = path.join(__dirname, 'flow-b-v2-respuestas.workflow.json');
fs.writeFileSync(out, JSON.stringify(wf, null, 2), 'utf8');
console.log('wrote ' + out);
console.log('  nodes: ' + nodes.length);
