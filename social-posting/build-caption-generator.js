#!/usr/bin/env node
/**
 * Builds Flow 5 — "Social — Generador de captions".
 *
 *   node build-caption-generator.js
 *
 * Reads the "Cola de publicaciones" sheet, finds rows the owner left in
 * estado = "borrador", asks Gemini to write the three captions, writes them
 * back and flips the row to "listo" so Flow 2 will pick it up on the next slot.
 *
 * Uses the Gemini REST endpoint through a plain HTTP Request node rather than
 * a LangChain node: it works on any n8n version and reuses the Header Auth
 * credential pattern already used for the Meta Graph nodes.
 *
 * No secret is written into this file. The API key lives in an n8n
 * "Header Auth" credential named "Gemini" (Name: x-goog-api-key).
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  sheetId: '1Q1Z46f1FZ7DWGuaFPTWKWeGn1tdxkBNdTFyNwyv4zus', // "Cola de publicaciones"
  timezone: 'America/Santiago',

  // flash-lite has the widest free-tier headroom: 15 req/min, 1000 req/day.
  model: 'gemini-2.5-flash-lite',

  // Free tier is rate limited per minute, so the loop paces itself.
  pauseSeconds: 5,
  maxPerRun: 12,

  ownerChatId: 'REPLACE_OWNER_CHAT_ID',
};

const TELEGRAM_CRED = {
  telegramApi: { id: 'F6I0NPw13xUehqey', name: 'Telegram account' },
};

// ---------------------------------------------------------------------------
// tiny node helpers — same shape as build-social-workflows.js
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

// ---------------------------------------------------------------------------
// The brief handed to Gemini. Kept in one place so tone changes are one edit.
// {{ARCHIVO}} and {{BRIEF}} are substituted per row inside the Code node.
// ---------------------------------------------------------------------------
const PROMPT = [
  'Eres el redactor de redes sociales de "Tengo Sed", una botilleria de barrio en',
  'Iquique, Chile.',
  '',
  'Escribe los textos de UNA publicacion.',
  '',
  'Archivo: {{ARCHIVO}}',
  'Indicacion del dueno: {{BRIEF}}',
  '',
  'Reglas que no se rompen:',
  '- Espanol de Chile, cercano y directo. Nada de lenguaje corporativo ni de agencia.',
  '- NO inventes precios, descuentos, marcas ni stock que no esten en la indicacion.',
  '- NO escribas el aviso del MINSAL. El sistema lo agrega solo al final.',
  '- Nunca sugieras consumo excesivo, ni menores de edad, ni manejar despues de beber.',
  '- Sin promesas de salud ni de efectos del alcohol.',
  '',
  'Formato de cada texto:',
  '- caption_ig: 1 o 2 frases con gancho + 3 a 6 hashtags locales',
  '  (por ejemplo #Iquique #TengoSed #Botilleria).',
  '- caption_fb: 2 o 3 frases, un poco mas informativo, sin hashtags.',
  '- caption_wa: UNA frase muy corta para el Estado de WhatsApp, invitando a pasar',
  '  por el local.',
  '',
  'Responde SOLO con este JSON, sin texto alrededor:',
  '{"caption_ig":"...","caption_fb":"...","caption_wa":"..."}',
].join('\n');

// ---------------------------------------------------------------------------
// FLOW 5
// ---------------------------------------------------------------------------
function buildCaptionGenerator() {
  const endpoint =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    CONFIG.model + ':generateContent';

  const nodes = [
    node('Cada manana 10:00', 'scheduleTrigger', 1.2, [-860, 300], {
      rule: { interval: [{ field: 'cronExpression', expression: '0 10 * * *' }] },
    }),

    node('O a mano', 'manualTrigger', 1, [-860, 480], {}),

    node('Leer la cola', 'googleSheets', 4.5, [-620, 380], {
      documentId: rl(CONFIG.sheetId),
      sheetName: rl('0'),
      options: {},
    }),

    node('Elegir borradores', 'code', 2, [-400, 380], {
      mode: 'runOnceForAllItems',
      jsCode: [
        '// Picks the rows the owner left as "borrador" — a filename, maybe a one-line',
        '// note, and nothing else. Anything already "listo", "pausa" or "publicado" is',
        '// left alone, so re-running this flow can never overwrite a written caption.',
        '',
        'const MAX = ' + CONFIG.maxPerRun + ';',
        'const PROMPT = ' + JSON.stringify(PROMPT) + ';',
        '',
        'const rows = $input.all().map(i => i.json);',
        '',
        'const drafts = rows.filter(r => {',
        '  const estado = String(r.estado || "").trim().toLowerCase();',
        '  const archivo = String(r.archivo || "").trim();',
        '  return estado === "borrador" && archivo !== "";',
        '});',
        '',
        'if (drafts.length === 0) {',
        '  return [{ json: { empty: true, reason: \'No hay filas en estado "borrador".\' } }];',
        '}',
        '',
        '// The free tier is capped per day, so a runaway sheet cannot drain it.',
        'return drafts.slice(0, MAX).map(r => {',
        '  const archivo = String(r.archivo).trim();',
        '  const brief = String(r.nota || r.brief || "").trim() ||',
        '    "(sin indicacion, guiate por el nombre del archivo)";',
        '',
        '  return {',
        '    json: {',
        '      empty: false,',
        '      rowId: r.id,',
        '      archivo,',
        '      brief,',
        '      prompt: PROMPT.replace("{{ARCHIVO}}", archivo).replace("{{BRIEF}}", brief),',
        '    },',
        '  };',
        '});',
      ].join('\n'),
    }),

    node('Hay borradores', 'if', 2.2, [-180, 380], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: 'hay-borradores',
          leftValue: '={{ $json.empty }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'false', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    }),

    node('Uno por uno', 'splitInBatches', 3, [60, 300], {
      batchSize: 1,
      options: {},
    }),

    node('Escribir con Gemini', 'httpRequest', 4.2, [300, 400], {
      method: 'POST',
      url: endpoint,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify({ contents: [ { parts: [ { text: $json.prompt } ] } ], ' +
        'generationConfig: { temperature: 0.9, responseMimeType: "application/json" } }) }}',
      options: { response: { response: { neverError: false } } },
    }),

    node('Leer la respuesta', 'code', 2, [520, 400], {
      mode: 'runOnceForEachItem',
      jsCode: [
        '// Gemini returns the JSON as a string inside candidates[0].content.parts[0].text.',
        '// responseMimeType "application/json" makes that string valid JSON, but a refusal',
        '// or a safety block comes back shaped differently — so this never assumes, and a',
        '// bad row is reported instead of poisoning the sheet.',
        '',
        'const src = $("Uno por uno").item.json;',
        'const raw = $json && $json.candidates && $json.candidates[0] &&',
        '  $json.candidates[0].content && $json.candidates[0].content.parts &&',
        '  $json.candidates[0].content.parts[0]',
        '    ? $json.candidates[0].content.parts[0].text || "" : "";',
        '',
        'let out;',
        'try {',
        '  out = JSON.parse(raw);',
        '} catch (e) {',
        '  return { json: { ok: false, rowId: src.rowId, archivo: src.archivo,',
        '    error: "Gemini no devolvio JSON valido: " + String(raw).slice(0, 200) } };',
        '}',
        '',
        'const clean = v => String(v || "").trim();',
        '',
        'const ig = clean(out.caption_ig);',
        'const fb = clean(out.caption_fb);',
        'const wa = clean(out.caption_wa);',
        '',
        'if (!ig || !fb || !wa) {',
        '  return { json: { ok: false, rowId: src.rowId, archivo: src.archivo,',
        '    error: "Falta alguno de los tres captions." } };',
        '}',
        '',
        'return { json: {',
        '  ok: true,',
        '  rowId: src.rowId,',
        '  archivo: src.archivo,',
        '  caption_ig: ig,',
        '  caption_fb: fb,',
        '  caption_wa: wa,',
        '} };',
      ].join('\n'),
    }),

    node('Guardar en la cola', 'googleSheets', 4.5, [740, 400], {
      operation: 'update',
      documentId: rl(CONFIG.sheetId),
      sheetName: rl('0'),
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['id'],
        value: {
          id: '={{ $json.rowId }}',
          caption_ig: '={{ $json.caption_ig }}',
          caption_fb: '={{ $json.caption_fb }}',
          caption_wa: '={{ $json.caption_wa }}',
          // Flow 2 only publishes rows in "listo", so this is the handoff.
          // A failed row stays "borrador" and is retried tomorrow.
          estado: '={{ $json.ok ? "listo" : "borrador" }}',
        },
      },
      options: {},
    }),

    node('Respirar', 'wait', 1.1, [960, 400], {
      amount: CONFIG.pauseSeconds,
      unit: 'seconds',
    }),

    node('Avisar al dueno', 'telegram', 1.2, [300, 180], {
      chatId: CONFIG.ownerChatId,
      text:
        '={{ "Captions listos: " + $items().length + " publicacion(es).\\n\\n" + ' +
        '$items().map(i => (i.json.ok ? "OK  " : "FALLO  ") + i.json.archivo).join("\\n") }}',
      additionalFields: {},
    }, { credentials: TELEGRAM_CRED }),

    sticky(
      '## Flow 5 — el redactor\n\n' +
      'Corre solo cada dia a las **10:00** (o dale a Execute cuando quieras).\n\n' +
      '**Como se usa:**\n' +
      '1. Subi la imagen a *1 Por publicar*\n' +
      '2. Agrega la fila con **solo** `archivo` y `estado` = `borrador`\n' +
      '3. Opcional: escribi una `nota` ("promo del finde", "llego cerveza artesanal")\n' +
      '4. Este flujo escribe los 3 captions y pasa la fila a `listo`\n\n' +
      '**Nunca pisa** una fila que ya este en `listo`, `pausa` o `publicado`.\n' +
      'Podes editar el texto a mano despues — Flow 2 usa lo que quede en la fila.',
      [-880, -180], 520, 380
    ),

    sticky(
      '## La credencial\n\n' +
      '**Header Auth** llamada `Gemini`:\n\n' +
      '- Name: `x-goog-api-key`\n' +
      '- Value: la key de https://aistudio.google.com/apikey\n\n' +
      'Modelo: `' + CONFIG.model + '` — free tier, **15 por minuto / 1000 por dia**.\n' +
      'Por eso *Respirar* espera ' + CONFIG.pauseSeconds + 's y solo se procesan ' +
      CONFIG.maxPerRun + ' filas por corrida.\n\n' +
      'El aviso del MINSAL **no** se pide aca — Flow 2 lo agrega solo, para que ' +
      'haya una sola fuente de esa frase.',
      [-340, -180], 500, 380, 4
    ),
  ];

  return wf('Social — Generador de captions', nodes, connect([
    ['Cada manana 10:00', 'Leer la cola'],
    ['O a mano', 'Leer la cola'],
    ['Leer la cola', 'Elegir borradores'],
    ['Elegir borradores', 'Hay borradores'],
    ['Hay borradores', 'Uno por uno', 0],
    ['Uno por uno', 'Avisar al dueno', 0],      // output 0 = done
    ['Uno por uno', 'Escribir con Gemini', 1],  // output 1 = loop
    ['Escribir con Gemini', 'Leer la respuesta'],
    ['Leer la respuesta', 'Guardar en la cola'],
    ['Guardar en la cola', 'Respirar'],
    ['Respirar', 'Uno por uno'],
  ]));
}

// ---------------------------------------------------------------------------
const out = path.join(__dirname, 'flow-5-generador-captions.workflow.json');
const built = buildCaptionGenerator();
fs.writeFileSync(out, JSON.stringify(built, null, 2));
console.log('wrote ' + path.basename(out) + ' — ' + built.nodes.length + ' nodes');
