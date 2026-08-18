#!/usr/bin/env node
/**
 * Builds the four n8n workflows for the Tengo Sed daily posting engine.
 *
 *   node build-social-workflows.js
 *
 * Emits one .workflow.json per flow, ready to import into
 * https://n8n.136.65.229.48.sslip.io  ->  Workflows  ->  Import from File.
 *
 * Everything an operator must change lives in CONFIG below or in a
 * REPLACE_* placeholder. No secrets are written into these files:
 * the Meta token lives in an n8n "Header Auth" credential, never here.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CONFIG — real ids, already created in Drive on 2026-08-17
// ---------------------------------------------------------------------------
const CONFIG = {
  n8nBase: 'https://n8n.136.65.229.48.sslip.io',

  driveQueueFolder: '12HvBwzoad40QwZz3rgHoMZTEB_Gysbrl', // "1 Por publicar"
  driveDoneFolder: '124LkQeu4SxY1qq5NMibeoj_LOalszo9-',  // "2 Publicado"
  sheetId: '1Q1Z46f1FZ7DWGuaFPTWKWeGn1tdxkBNdTFyNwyv4zus', // "Cola de publicaciones"

  mediaPath: 'tengosed-media',
  graphVersion: 'v21.0',
  timezone: 'America/Santiago',

  // Filled in by the operator after the Meta app exists.
  igUserId: 'REPLACE_IG_USER_ID',
  fbPageId: 'REPLACE_FB_PAGE_ID',
  ownerChatId: 'REPLACE_OWNER_CHAT_ID',

  // Random 24-byte secret, generated 2026-08-17. Only guards the media
  // endpoint from being an open Drive proxy — change it any time, but change
  // it in Flow 2 and Flow 3 together or the link stops validating.
  mediaSecret: 'KHgDO9uohdVM02EVYtY44i_fc2j7Lzr5',
};

// Telegram bot already in use by the Tessa flows — reused so the nodes arrive
// pre-wired instead of needing to be attached by hand after import.
const TELEGRAM_CRED = {
  telegramApi: { id: 'F6I0NPw13xUehqey', name: 'Telegram account' },
};

// The posting calendar, collapsed from 20 clock times to 10 cron rules.
const CRON_RULES = [
  ['5 12 * * 1-6', 'Mon-Sat 12:05'],
  ['30 13 * * 1-6', 'Mon-Sat 13:30'],
  ['5 13 * * 0', 'Sun 13:05'],
  ['30 14 * * 0', 'Sun 14:30'],
  ['23 15 * * *', 'daily 15:23'],
  ['0 16 * * 5,6', 'Fri-Sat 16:00'],
  ['0 19 * * *', 'daily 19:00'],
  ['30 20 * * *', 'daily 20:30'],
  ['20 21 * * *', 'daily 21:20'],
  ['0 23 * * 5,6', 'Fri-Sat 23:00'],
];

// ---------------------------------------------------------------------------
// tiny node helpers
// ---------------------------------------------------------------------------
const node = (name, type, typeVersion, position, parameters = {}, extra = {}) => ({
  parameters,
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  name,
  type: `n8n-nodes-base.${type}`,
  typeVersion,
  position,
  ...extra,
});

const sticky = (content, position, width = 460, height = 260, color = 2) =>
  node(`Note ${Math.random().toString(36).slice(2, 6)}`, 'stickyNote', 1, position, {
    content, width, height, color,
  });

const rl = (value, mode = 'id') => ({ __rl: true, value, mode });

/** Build the connections map from a list of [from, to] pairs. */
function connect(pairs) {
  const out = {};
  for (const [from, to, outputIndex = 0] of pairs) {
    out[from] = out[from] || { main: [] };
    while (out[from].main.length <= outputIndex) out[from].main.push([]);
    out[from].main[outputIndex].push({ node: to, type: 'main', index: 0 });
  }
  return out;
}

const wf = (name, nodes, connections) => ({
  name,
  nodes,
  connections,
  settings: { executionOrder: 'v1', timezone: CONFIG.timezone, saveManualExecutions: true },
  pinData: {},
});

/** A boolean IF node on a single field. */
const ifBool = (name, field, position) =>
  node(name, 'if', 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{
        id: `${name}-cond`,
        leftValue: `={{ $json.${field} }}`,
        rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      }],
      combinator: 'and',
    },
    options: {},
  });

/** An HTTP node against the Meta Graph API using the shared Header Auth credential. */
const graph = (name, method, url, position, queryParams) =>
  node(name, 'httpRequest', 4.2, position, {
    method,
    url,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendQuery: true,
    queryParameters: { parameters: queryParams },
    options: { response: { response: { neverError: false } } },
  });

// ===========================================================================
// FLOW 1 — Programador (the clock)
// ===========================================================================
function buildScheduler() {
  const nodes = [
    node('Horarios Tengo Sed', 'scheduleTrigger', 1.2, [-420, 300], {
      rule: {
        interval: CRON_RULES.map(([expression]) => ({
          field: 'cronExpression',
          expression,
        })),
      },
    }),

    node('Marcar el slot', 'code', 2, [-180, 300], {
      mode: 'runOnceForAllItems',
      jsCode: `
// Stamps which slot fired, so the publisher and the ledger agree on "when".
const now = new Date();
const santiago = new Intl.DateTimeFormat('es-CL', {
  timeZone: '${CONFIG.timezone}',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(now);

return [{ json: {
  slot: santiago,
  firedAt: now.toISOString(),
} }];
`.trim(),
    }),

    node('Publicar', 'executeWorkflow', 1.2, [60, 300], {
      workflowId: rl('REPLACE_PUBLICADOR_WORKFLOW_ID'),
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [] },
      options: { waitForSubWorkflow: true },
    }),

    sticky(
      `## Flow 1 — the clock\n\n` +
      `10 cron rules covering all 46 weekly slots:\n\n` +
      CRON_RULES.map(([e, label]) => `- \`${e}\`  ${label}`).join('\n') +
      `\n\n**Timezone is set on the workflow** (Settings -> Timezone = ` +
      `${CONFIG.timezone}). If that is wrong every slot lands 4 hours off.\n\n` +
      `Set **Publicar -> Workflow** to the "Social — Publicador" workflow ` +
      `after you import it.`,
      [-430, -60], 520, 400
    ),
  ];

  return wf('Social — Programador', nodes, connect([
    ['Horarios Tengo Sed', 'Marcar el slot'],
    ['Marcar el slot', 'Publicar'],
  ]));
}

// ===========================================================================
// FLOW 2 — Publicador (one slot, end to end)
// ===========================================================================
function buildPublisher() {
  const G = `https://graph.facebook.com/${CONFIG.graphVersion}`;

  const nodes = [
    node('Cuando el programador llama', 'executeWorkflowTrigger', 1.1, [-900, 400], {
      inputSource: 'passthrough',
    }),

    node('Leer la cola', 'googleSheets', 4.5, [-680, 400], {
      documentId: rl(CONFIG.sheetId),
      sheetName: rl('0'),
      options: {},
    }),

    node('Elegir el siguiente', 'code', 2, [-460, 400], {
      mode: 'runOnceForAllItems',
      jsCode: `
// Picks the next row to publish. Rules, in order:
//   1. estado must be "listo" (anything else is skipped: pausa, publicado, blank)
//   2. prioridad "alta" jumps the queue
//   3. otherwise oldest row first (sheet order)
// Nothing here mutates the sheet — the ledger step at the end does that.

const IG_USER_ID = '${CONFIG.igUserId}';
const FB_PAGE_ID = '${CONFIG.fbPageId}';
const OWNER_CHAT_ID = '${CONFIG.ownerChatId}';
const MEDIA_SECRET = '${CONFIG.mediaSecret}';
const MEDIA_BASE = '${CONFIG.n8nBase}/webhook/${CONFIG.mediaPath}';

// Chile requires the MINSAL warning on alcohol advertising.
const AVISO = 'Bebe con moderacion. Prohibida su venta a menores de 18 anos.';

const rows = $input.all().map(i => i.json);
const ready = rows.filter(r => String(r.estado || '').trim().toLowerCase() === 'listo');

if (ready.length === 0) {
  return [{ json: { empty: true, reason: 'No hay filas en estado "listo".' } }];
}

ready.sort((a, b) => {
  const pa = String(a.prioridad || '').toLowerCase() === 'alta' ? 0 : 1;
  const pb = String(b.prioridad || '').toLowerCase() === 'alta' ? 0 : 1;
  return pa - pb;
});

const row = ready[0];
const archivo = String(row.archivo || '').trim();

if (!archivo) {
  return [{ json: { empty: true, reason: 'La fila ' + row.id + ' no tiene archivo.' } }];
}

const esVideo = /\\.(mp4|mov|m4v)$/i.test(archivo);

// Append the MINSAL notice unless the caption already carries it.
const withAviso = (t) => {
  const s = String(t || '').trim();
  if (!s) return AVISO;
  return s.toLowerCase().includes('moderacion') ? s : s + '\\n\\n' + AVISO;
};

return [{ json: {
  empty: false,
  rowId: row.id,
  archivo,
  esVideo,
  captionIg: withAviso(row.caption_ig),
  captionFb: withAviso(row.caption_fb),
  captionWa: withAviso(row.caption_wa),
  igUserId: IG_USER_ID,
  fbPageId: FB_PAGE_ID,
  ownerChatId: OWNER_CHAT_ID,
  mediaSecret: MEDIA_SECRET,
  mediaBase: MEDIA_BASE,
  slot: $('Cuando el programador llama').first().json.slot || '',
} }];
`.trim(),
    }),

    ifBool('Hay algo que publicar', 'empty', [-240, 400]),

    node('Avisar cola vacia', 'telegram', 1.2, [-40, 560], {
      chatId: `={{ $json.ownerChatId || '${CONFIG.ownerChatId}' }}`,
      text: '={{ "Slot sin publicar.\\n\\n" + $json.reason + "\\n\\nAgrega filas en estado listo a la Cola de publicaciones." }}',
      additionalFields: { appendAttribution: false },
    }, { credentials: TELEGRAM_CRED }),

    node('Buscar el archivo', 'googleDrive', 3, [-40, 300], {
      resource: 'fileFolder',
      queryString: '={{ $json.archivo }}',
      filter: { folderId: rl(CONFIG.driveQueueFolder) },
      options: { fields: ['id', 'name', 'mimeType'] },
    }),

    node('Armar el post', 'code', 2, [180, 300], {
      mode: 'runOnceForAllItems',
      jsCode: `
// Turns the Drive hit + the queue row into the exact payloads each platform wants.
const post = $('Elegir el siguiente').first().json;
const hit = $input.first().json;

if (!hit || !hit.id) {
  throw new Error('No se encontro "' + post.archivo + '" en la carpeta 1 Por publicar.');
}

// The media link Meta will fetch from. It carries a shared token so the
// endpoint is not an open proxy to the whole Drive. The file becomes public
// on Instagram seconds later, so a signed short link is proportionate here.
const mediaUrl = post.mediaBase
  + '?id=' + encodeURIComponent(hit.id)
  + '&t=' + encodeURIComponent(post.mediaSecret);

return [{ json: {
  ...post,
  fileId: hit.id,
  mimeType: hit.mimeType,
  mediaUrl,
  publishedAt: new Date().toISOString(),
} }];
`.trim(),
    }),

    // ---- Instagram lane -----------------------------------------------
    graph('IG crear contenedor', 'POST', `=${G}/{{ $json.igUserId }}/media`, [420, 120], [
      { name: '={{ $json.esVideo ? "video_url" : "image_url" }}', value: '={{ $json.mediaUrl }}' },
      { name: 'caption', value: '={{ $json.captionIg }}' },
      { name: 'media_type', value: '={{ $json.esVideo ? "REELS" : "IMAGE" }}' },
    ]),

    node('Esperar proceso', 'wait', 1.1, [620, 120], { amount: 8, unit: 'seconds' }),

    graph('IG revisar estado', 'GET', `=${G}/{{ $('IG crear contenedor').item.json.id }}`, [820, 120], [
      { name: 'fields', value: 'status_code,status' },
    ]),

    node('Listo o esperar', 'code', 2, [1020, 120], {
      mode: 'runOnceForAllItems',
      jsCode: `
// Instagram stages media asynchronously. Publishing before it reports
// FINISHED produces an empty post, so we poll — but never forever.
const MAX_TRIES = 12;               // 12 x 8s = ~96s, enough for a Reel
const code = String($json.status_code || '').toUpperCase();
const tries = $runIndex + 1;

if (code === 'FINISHED') return [{ json: { ready: true, giveUp: false, tries } }];
if (code === 'ERROR' || code === 'EXPIRED') {
  throw new Error('Instagram rechazo el contenedor: ' + ($json.status || code));
}
if (tries >= MAX_TRIES) {
  throw new Error('El contenedor sigue en ' + code + ' tras ' + tries + ' intentos.');
}
return [{ json: { ready: false, giveUp: false, tries } }];
`.trim(),
    }),

    ifBool('Contenedor listo', 'ready', [1220, 120]),

    graph('IG publicar', 'POST', `=${G}/{{ $('Armar el post').item.json.igUserId }}/media_publish`, [1440, 40], [
      { name: 'creation_id', value: "={{ $('IG crear contenedor').item.json.id }}" },
    ]),

    // ---- Facebook lane ------------------------------------------------
    graph('FB publicar', 'POST',
      `=${G}/{{ $json.fbPageId }}/{{ $json.esVideo ? "videos" : "photos" }}`, [420, 340], [
      { name: '={{ $json.esVideo ? "file_url" : "url" }}', value: '={{ $json.mediaUrl }}' },
      { name: '={{ $json.esVideo ? "description" : "caption" }}', value: '={{ $json.captionFb }}' },
      { name: 'published', value: 'true' },
    ]),

    // ---- WhatsApp lane (draft to the phone) ----------------------------
    node('WA borrador al telefono', 'telegram', 1.2, [420, 560], {
      operation: 'sendPhoto',
      chatId: '={{ $json.ownerChatId }}',
      file: '={{ $json.mediaUrl }}',
      additionalFields: {
        caption: '={{ "ESTADO DE WHATSAPP — " + $json.slot + "\\n\\n" + $json.captionWa + "\\n\\nGuarda la imagen y subela a Estado." }}',
        appendAttribution: false,
      },
    }, { credentials: TELEGRAM_CRED }),

    // ---- Ledger --------------------------------------------------------
    node('Juntar resultados', 'merge', 3, [1680, 340], {
      mode: 'combine',
      combineBy: 'combineAll',
      numberInputs: 3,
      options: {},
    }),

    node('Marcar publicado', 'googleSheets', 4.5, [1900, 340], {
      operation: 'update',
      documentId: rl(CONFIG.sheetId),
      sheetName: rl('0'),
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['id'],
        value: {
          id: "={{ $('Armar el post').item.json.rowId }}",
          estado: 'publicado',
          publicado_en: "={{ $('Armar el post').item.json.publishedAt }}",
          link_ig: "={{ $('IG publicar').item.json.id || '' }}",
          link_fb: "={{ $('FB publicar').item.json.post_id || $('FB publicar').item.json.id || '' }}",
        },
      },
      options: {},
    }),

    node('Archivar el medio', 'googleDrive', 3, [2120, 340], {
      operation: 'move',
      fileId: rl("={{ $('Armar el post').item.json.fileId }}"),
      driveId: rl('My Drive', 'list'),
      folderId: rl(CONFIG.driveDoneFolder),
      options: {},
    }),

    sticky(
      `## Flow 2 — one slot, end to end\n\n` +
      `**Before this runs, set in "Elegir el siguiente":**\n` +
      `- \`IG_USER_ID\` — Instagram Business account id\n` +
      `- \`FB_PAGE_ID\` — Facebook Page id\n` +
      `- \`OWNER_CHAT_ID\` — your Telegram chat id\n` +
      `- \`MEDIA_SECRET\` — same string as in Flow 3\n\n` +
      `**Credential:** every Graph node uses a Header Auth credential.\n` +
      `Create it once as: Name \`Authorization\`, Value \`Bearer <page token>\`.\n\n` +
      `**Verify after import:** the two Google Sheets nodes and the Drive\n` +
      `nodes use resource-locator pickers. Open each and re-pick the\n` +
      `document / folder from the dropdown so n8n caches the display name.`,
      [-910, 20], 560, 420, 3
    ),

    sticky(
      `## Why Instagram needs three calls\n\n` +
      `create container -> poll status -> publish.\n\n` +
      `Skipping the poll is the usual cause of "it posted but the image is\n` +
      `blank". Videos legitimately sit in IN_PROGRESS for up to a minute.\n\n` +
      `The loop gives up after 12 tries (~96s) and raises, which hands the\n` +
      `failure to Flow 4 rather than publishing something broken.`,
      [420, -140], 520, 240, 4
    ),
  ];

  return wf('Social — Publicador', nodes, connect([
    ['Cuando el programador llama', 'Leer la cola'],
    ['Leer la cola', 'Elegir el siguiente'],
    ['Elegir el siguiente', 'Hay algo que publicar'],
    ['Hay algo que publicar', 'Avisar cola vacia', 0],   // empty === true
    ['Hay algo que publicar', 'Buscar el archivo', 1],   // empty === false
    ['Buscar el archivo', 'Armar el post'],
    ['Armar el post', 'IG crear contenedor'],
    ['Armar el post', 'FB publicar'],
    ['Armar el post', 'WA borrador al telefono'],
    ['IG crear contenedor', 'Esperar proceso'],
    ['Esperar proceso', 'IG revisar estado'],
    ['IG revisar estado', 'Listo o esperar'],
    ['Listo o esperar', 'Contenedor listo'],
    ['Contenedor listo', 'IG publicar', 0],
    ['Contenedor listo', 'Esperar proceso', 1],          // loop back
    ['IG publicar', 'Juntar resultados'],
    ['FB publicar', 'Juntar resultados'],
    ['WA borrador al telefono', 'Juntar resultados'],
    ['Juntar resultados', 'Marcar publicado'],
    ['Marcar publicado', 'Archivar el medio'],
  ]));
}

// ===========================================================================
// FLOW 3 — Servidor de medios (the public link Meta fetches)
// ===========================================================================
function buildMediaServer() {
  const nodes = [
    node('Peticion de medio', 'webhook', 2, [-420, 300], {
      httpMethod: 'GET',
      path: CONFIG.mediaPath,
      responseMode: 'responseNode',
      options: {},
    }),

    node('Validar token', 'code', 2, [-200, 300], {
      mode: 'runOnceForAllItems',
      jsCode: `
// This endpoint is public by necessity — Meta's servers must reach it
// without credentials. The shared token keeps it from becoming an open
// proxy to the entire Drive account.
const MEDIA_SECRET = '${CONFIG.mediaSecret}';

const q = $json.query || {};
if (!q.t || q.t !== MEDIA_SECRET) {
  throw new Error('Token invalido para ' + (q.id || 'sin id'));
}
if (!q.id) {
  throw new Error('Falta el parametro id.');
}
return [{ json: { fileId: q.id } }];
`.trim(),
    }),

    node('Bajar de Drive', 'googleDrive', 3, [20, 300], {
      operation: 'download',
      fileId: rl('={{ $json.fileId }}'),
      options: { binaryPropertyName: 'data' },
    }),

    node('Entregar el archivo', 'respondToWebhook', 1.1, [240, 300], {
      respondWith: 'binary',
      responseDataSource: 'set',
      inputFieldName: 'data',
      options: {
        responseHeaders: {
          entries: [{ name: 'Cache-Control', value: 'public, max-age=300' }],
        },
      },
    }),

    sticky(
      `## Flow 3 — the public media link\n\n` +
      `**This workflow must stay ACTIVE.** If it is off, Instagram and\n` +
      `Facebook get a 404 when they try to download, and every slot fails.\n\n` +
      `Production URL:\n` +
      `\`${CONFIG.n8nBase}/webhook/${CONFIG.mediaPath}?id=<fileId>&t=<secret>\`\n\n` +
      `Set \`MEDIA_SECRET\` here to the same value used in Flow 2.\n` +
      `Change it any time — just change it in both places.\n\n` +
      `Scope: it only ever serves a file whose id the caller already knows,\n` +
      `and only with the token. It is not a Drive browser.`,
      [-430, 20], 560, 260, 5
    ),
  ];

  return wf('Social — Servidor de medios', nodes, connect([
    ['Peticion de medio', 'Validar token'],
    ['Validar token', 'Bajar de Drive'],
    ['Bajar de Drive', 'Entregar el archivo'],
  ]));
}

// ===========================================================================
// FLOW 4 — Alertas
// ===========================================================================
function buildAlerts() {
  const nodes = [
    node('Si algo falla', 'errorTrigger', 1, [-400, 300], {}),

    node('Redactar la alerta', 'code', 2, [-160, 300], {
      mode: 'runOnceForAllItems',
      jsCode: `
const OWNER_CHAT_ID = '${CONFIG.ownerChatId}';

const e = $json.execution ?? {};
const w = $json.workflow ?? {};
const err = e.error ?? {};

const when = new Date(e.startedAt ?? Date.now()).toLocaleString('es-CL', {
  timeZone: '${CONFIG.timezone}',
});

const lines = [
  'NO SE PUBLICO UN SLOT',
  '',
  'Workflow: ' + (w.name ?? 'desconocido'),
  'Cuando: ' + when,
];
if (err.node?.name) lines.push('Nodo: ' + err.node.name);
lines.push('Error: ' + (err.message ?? 'sin mensaje'));
if (e.url) { lines.push(''); lines.push('Ver ejecucion: ' + e.url); }
lines.push('');
lines.push('La fila sigue en estado listo, se reintenta en el proximo horario.');

let report = lines.join('\\n');
if (report.length > 3900) report = report.slice(0, 3890) + '\\n... (cortado)';

return [{ json: { chat_id: OWNER_CHAT_ID, report } }];
`.trim(),
    }),

    node('Avisar por Telegram', 'telegram', 1.2, [80, 300], {
      chatId: '={{ $json.chat_id }}',
      text: '={{ $json.report }}',
      additionalFields: { appendAttribution: false },
    }, { credentials: TELEGRAM_CRED }),

    sticky(
      `## Flow 4 — alerts\n\n` +
      `Wire this up: open Flows 1, 2 and 3 -> **Settings** ->\n` +
      `**Error Workflow** -> pick this one. Without that it never fires.\n\n` +
      `Do not set this workflow as its own error workflow — it would loop.\n\n` +
      `A failed slot is deliberately NOT retried immediately: the row stays\n` +
      `\`listo\` and the next scheduled slot picks it up. Retrying inside the\n` +
      `same minute mostly just burns the Graph rate limit.`,
      [-410, 20], 520, 250, 2
    ),
  ];

  return wf('Social — Alertas', nodes, connect([
    ['Si algo falla', 'Redactar la alerta'],
    ['Redactar la alerta', 'Avisar por Telegram'],
  ]));
}

// ---------------------------------------------------------------------------
const outputs = [
  ['flow-1-programador.workflow.json', buildScheduler()],
  ['flow-2-publicador.workflow.json', buildPublisher()],
  ['flow-3-servidor-medios.workflow.json', buildMediaServer()],
  ['flow-4-alertas.workflow.json', buildAlerts()],
];

for (const [file, workflow] of outputs) {
  const dest = path.join(__dirname, file);
  fs.writeFileSync(dest, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
  const real = workflow.nodes.filter(n => n.type !== 'n8n-nodes-base.stickyNote').length;
  console.log(`${file.padEnd(38)} ${String(real).padStart(2)} nodes`);
}
console.log('\nDone. Import each file in n8n -> Workflows -> Import from File.');
