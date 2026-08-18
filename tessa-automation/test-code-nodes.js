#!/usr/bin/env node
/**
 * Runs the Code nodes from the generated workflows against fake
 * ControlVentas-shaped rows, outside n8n. Catches logic bugs before import.
 * Run: node test-code-nodes.js
 */
const fs = require('fs');
const path = require('path');

const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const codeOf = (wf, name) => wf.nodes.find(n => n.name === name).parameters.jsCode;

// Fake exports. Spanish headers, ; separator, Chilean number format,
// deliberately including a store column and a min column.
const stock = [
  { 'Código': '7801', 'Nombre': 'Cerveza Cristal 470', 'Local': 'LOCAL 1', 'Stock': '24', 'Precio': '1.290', 'Minimo': '12' },
  { 'Código': '7802', 'Nombre': 'Ron Havana 3a',        'Local': 'LOCAL 1', 'Stock': '3',  'Precio': '12.990', 'Minimo': '6' },
  { 'Código': '7803', 'Nombre': 'Pisco Alto del Carmen','Local': 'LOCAL 1', 'Stock': '40', 'Precio': '0',      'Minimo': '10' },
  { 'Código': '7801', 'Nombre': 'Cerveza Cristal 470',  'Local': 'LOCAL 2', 'Stock': '8',  'Precio': '1.290',  'Minimo': '12' },
  { 'Código': '7804', 'Nombre': 'Vino Gato Negro',      'Local': 'LOCAL 2', 'Stock': '55', 'Precio': '3.490',  'Minimo': '10' },
];
const ventas = [
  { 'Código': '7801', 'Local': 'LOCAL 1', 'Vendido': '6', 'Precio': '1.290' },
  { 'Código': '7802', 'Local': 'LOCAL 1', 'Vendido': '2', 'Precio': '9.990' }, // 23% off list -> under threshold
  { 'Código': '7804', 'Local': 'LOCAL 2', 'Vendido': '9', 'Precio': '2.000' }, // 43% off -> flagged
];
const conteo = [
  { 'Código': '7801', 'Local': 'LOCAL 1', 'Conteo': '22' }, // faltan 2
  { 'Código': '7802', 'Local': 'LOCAL 1', 'Conteo': '3'  }, // ok
  { 'Código': '7804', 'Local': 'LOCAL 2', 'Conteo': '58' }, // sobran 3
];

function makeRunner(sources, triggerJson) {
  const $ = (name) => {
    if (!(name in sources)) throw new Error('unknown node ' + name);
    const items = sources[name].map(json => ({ json }));
    return { all: () => items, first: () => items[0] };
  };
  return (code) => new Function('$', '$json', code)($, triggerJson ?? {});
}

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) { console.log('  PASS  ' + label); }
  else { failures++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
};

// --------------------------------------------------------------------------
const flowA = load('flow-a-daily-engine.workflow.json');
const runA = makeRunner({ 'CSV stock': stock, 'CSV ventas': ventas, 'CSV conteo': conteo });

console.log('\nCalc core');
const calc = runA(codeOf(flowA, 'Calc core'));
const l1 = calc.find(i => i.json.store === 'LOCAL 1').json;
const l2 = calc.find(i => i.json.store === 'LOCAL 2').json;

check('one output item per store', calc.length === 2, 'got ' + calc.length);
check('LOCAL 1 finds the -2 variance on 7801',
  l1.variances.some(v => v.sku === '7801' && v.variance === 2));
check('LOCAL 2 finds the +3 overage on 7804',
  l2.variances.some(v => v.sku === '7804' && v.variance === -3));
check('7802 (stock 3 <= min 6) is a reorder',
  l1.reorders.some(r => r.sku === '7802'));
check('7801 in LOCAL 2 (stock 8 <= min 12) is a reorder',
  l2.reorders.some(r => r.sku === '7801'));
check('7801 in LOCAL 1 (stock 24 > min 12) is NOT a reorder',
  !l1.reorders.some(r => r.sku === '7801'));
check('zero price on 7803 is flagged',
  l1.price_flags.some(p => p.sku === '7803' && /cero/.test(p.reason)));
check('7804 sold 43% under list is flagged',
  l2.price_flags.some(p => p.sku === '7804' && /distinto/.test(p.reason)));
check('7802 sold 23% under list is NOT flagged (below 25% threshold)',
  !l1.price_flags.some(p => p.sku === '7802'));
// Regression: '1.290' must parse as 1290, not 1.29. 2 missing units at $1.290
// is $2.580 of shrinkage — the earlier parser reported $3.
const v7801 = l1.variances.find(v => v.sku === '7801');
check('Chilean thousands-dot parsed correctly (2 x $1.290 = $2.580)',
  v7801.value === 2580, 'got ' + v7801.value);
check('the report prints the real peso amount',
  l1.report.includes('$2.580'), 'report says: ' + (l1.report.match(/\$[\d.,]+/g) || []).join(' '));
check('report is plain text with no emoji',
  typeof l1.report === 'string' && !/[\u{1F300}-\u{1FAFF}]/u.test(l1.report));
check('report fits Telegram 4096 limit', l1.report.length < 4096, l1.report.length + ' chars');
check('chat_id resolved from CONFIG.stores', l1.chat_id === 'REPLACE_CHAT_ID_1');

console.log('\n--- sample LOCAL 1 report ---');
console.log(l1.report);
console.log('----------------------------\n');

console.log('Cycle count dispatch');
const cycle = runA(codeOf(flowA, 'Cycle count dispatch'));
check('one dispatch per store', cycle.length === 2, 'got ' + cycle.length);
check('never dispatches more than the catalog holds',
  cycle.every(c => c.json.skus.length <= 5 && c.json.skus.length > 0));
check('dispatch text lists the SKUs',
  cycle[0].json.report.includes(cycle[0].json.skus[0].sku));

// --------------------------------------------------------------------------
console.log('\nCommand router');
const flowB = load('flow-b-telegram-commands.workflow.json');
const routerCode = codeOf(flowB, 'Command router');

const ask = (text) => {
  const trigger = { message: { text, chat: { id: 12345 } } };
  const run = makeRunner({ 'CSV stock': stock, 'Telegram trigger': [trigger] });
  return run(routerCode)[0].json;
};

check('/ayuda returns the help text', ask('/ayuda').reply.includes('/inventario'));
check('/inventario 7801 finds both locales',
  (ask('/inventario 7801').reply.match(/LOCAL/g) || []).length === 2);
check('/inventario by name works', ask('/inventario cristal').reply.includes('7801'));
check('/inventario with no arg explains usage', ask('/inventario').reply.startsWith('Uso:'));
check('/precio formats CLP', ask('/precio 7802').reply.includes('$12.990'));
check('/bajos lists 7802 and the LOCAL 2 cerveza',
  ask('/bajos').reply.includes('7802') && ask('/bajos').reply.includes('7801'));
check('/resumen totals per local', ask('/resumen').reply.includes('LOCAL 1') && ask('/resumen').reply.includes('LOCAL 2'));
check('unknown command falls back to help', ask('/pizza').reply.includes('No conozco'));
check('/inventario@TessaBot strips the bot suffix',
  ask('/inventario@TessaBot 7801').reply.includes('7801'));
check('reply respects the Telegram limit', ask('/bajos').reply.length < 4096);
check('chat id echoed back', ask('/ayuda').chat_id === 12345);

// --------------------------------------------------------------------------
// Degraded runs. The Drive nodes are set to alwaysOutputData + continue-on-error,
// so a missing file arrives as an empty item rather than stopping the workflow.
// --------------------------------------------------------------------------
console.log('\nDegraded inputs');
const calcCode = codeOf(flowA, 'Calc core');

const runWith = (s, v, c) => makeRunner({ 'CSV stock': s, 'CSV ventas': v, 'CSV conteo': c })(calcCode);

// n8n emits [{}] (one empty item) for a node that produced nothing.
const EMPTY = [{}];

let noConteo;
check('missing conteo.csv does not throw', (() => {
  try { noConteo = runWith(stock, ventas, EMPTY); return true; } catch (e) { return false; }
})());
if (noConteo) {
  check('...and still reports reorders', noConteo.some(i => i.json.reorders.length > 0));
  check('...with zero variances', noConteo.every(i => i.json.variances.length === 0));
  check('...saying nothing was counted', noConteo[0].json.counts.counted === 0);
}

let noVentas;
check('missing ventas.csv does not throw', (() => {
  try { noVentas = runWith(stock, EMPTY, conteo); return true; } catch (e) { return false; }
})());
if (noVentas) {
  check('...and still reports variances', noVentas.some(i => i.json.variances.length > 0));
}

check('missing stock.csv fails loudly with a usable message', (() => {
  try { runWith(EMPTY, ventas, conteo); return false; }
  catch (e) { return /stock\.csv/.test(e.message); }
})());

check('unrecognizable SKU header names the real columns in the error', (() => {
  try {
    runWith([{ 'FOO': '1', 'BAR': '2' }], EMPTY, EMPTY);
    return false;
  } catch (e) { return e.message.includes('FOO') && e.message.includes('skuColumns'); }
})());

// --------------------------------------------------------------------------
console.log('\nError alert formatter');
const flowC = load('flow-c-error-alerts.workflow.json');
const errCode = codeOf(flowC, 'Format the alert');
const errPayload = {
  execution: {
    startedAt: '2026-08-03T12:00:00.000Z',
    url: 'https://n8n.136.65.229.48.sslip.io/workflow/1/executions/9',
    error: { message: 'ENOTFOUND drive.google.com', node: { name: 'Get stock.csv' } },
  },
  workflow: { name: 'Tessa — Flow A — Daily inventory engine' },
};
const alert = new Function('$json', errCode)(errPayload)[0].json;
check('alert names the workflow', alert.report.includes('Flow A'));
check('alert names the failing node', alert.report.includes('Get stock.csv'));
check('alert carries the error message', alert.report.includes('ENOTFOUND'));
check('alert links the execution', alert.report.includes('/executions/9'));
check('alert survives a payload with nothing in it', (() => {
  const bare = new Function('$json', errCode)({})[0].json;
  return bare.report.includes('FALLO') && bare.report.length < 4096;
})());

// --------------------------------------------------------------------------
console.log('\nCount replies via Telegram (Data Table)');
const askRaw = (text, chat) => {
  const trigger = { message: { text, chat: { id: chat ?? 12345, title: 'LOCAL 1' },
                               from: { first_name: 'Jorge', username: 'jorge' } } };
  const run = makeRunner({ 'CSV stock': stock, 'Telegram trigger': [trigger] });
  return run(routerCode).map(i => i.json);
};

const counted = askRaw('7801 22\n7802 3');
check('a "SKU cantidad" message is detected as a count', counted.every(r => r.is_count === true));
check('one item per counted product', counted.length === 2);
check('parses sku and qty', counted[0].sku === '7801' && counted[0].qty === 22);
check('stamps who reported it', counted[0].reported_by === 'Jorge');
check('stamps an ISO timestamp', /^\d{4}-\d{2}-\d{2}T/.test(counted[0].counted_at));
check('only the first item carries the confirmation text',
  counted[0].reply.length > 0 && counted[1].reply === '');
check('confirmation lists both products',
  counted[0].reply.includes('7801') && counted[0].reply.includes('7802'));
check('separators like "7801: 22" and "7801 - 22" work',
  askRaw('7801: 22')[0]?.qty === 22 && askRaw('7801 - 22')[0]?.qty === 22);
check('warns about a SKU that is not in stock',
  askRaw('9999 5')[0].reply.includes('no estan en el stock'));
check('reports lines it could not read',
  askRaw('7801 22\nque tal todo').find(r => r.reply)?.reply.includes('que tal todo'));
check('ordinary chat is NOT swallowed as a count',
  askRaw('hola, ya cerramos el local')[0].is_count === false);
check('a command is still a command, not a count',
  askRaw('/resumen')[0].is_count === false);
check('chat id resolves the store when it matches CONFIG.stores',
  askRaw('7801 22', 'REPLACE_CHAT_ID_2')[0].store === 'LOCAL 2');

// --------------------------------------------------------------------------
console.log('\nCounts from the Data Table beat conteo.csv');
const tableRows = [
  { sku: '7801', store: 'LOCAL 1', qty: 20, counted_at: '2026-08-03T10:00:00Z', reported_by: 'Jorge' },
  // a correction sent later for the same SKU — the newer one must win
  { sku: '7801', store: 'LOCAL 1', qty: 19, counted_at: '2026-08-03T18:00:00Z', reported_by: 'Jorge' },
];
const withTable = makeRunner({
  'CSV stock': stock, 'CSV ventas': ventas, 'CSV conteo': conteo, 'Get counts': tableRows,
})(calcCode);
const t1 = withTable.find(i => i.json.store === 'LOCAL 1').json;
check('table counts override conteo.csv',
  t1.variances.find(v => v.sku === '7801').physical === 19, 'got ' + t1.variances.find(v => v.sku === '7801')?.physical);
check('the newest correction wins (19, not 20)',
  t1.variances.find(v => v.sku === '7801').variance === 5);
check('count_source is flagged as data_table', t1.count_source === 'data_table');
check('report says the count came via Telegram', t1.report.includes('conteo por Telegram'));
check('falls back to csv when the table is empty', (() => {
  const r = makeRunner({'CSV stock':stock,'CSV ventas':ventas,'CSV conteo':conteo,'Get counts':[{}]})(calcCode);
  return r[0].json.count_source === 'csv';
})());

// --------------------------------------------------------------------------
console.log('\nHeartbeat');
const hbCode = codeOf(flowA, 'Heartbeat');
const hb = makeRunner({ 'Calc core': calc.map(i => i.json) })(hbCode)[0].json;
check('heartbeat says the engine ran', hb.report.includes('Motor de inventario OK'));
check('heartbeat counts the stores', hb.report.includes('Locales procesados: 2'));
check('heartbeat totals the shrinkage in pesos', /Diferencias: \d+ \(\$[\d.]+\)/.test(hb.report));
check('heartbeat explains what silence means', hb.report.includes('no corrio'));
check('heartbeat goes to the owner placeholder', hb.chat_id === 'REPLACE_OWNER_CHAT_ID');

console.log('\n' + (failures ? failures + ' FAILING CHECK(S)' : 'all checks passed'));
process.exit(failures ? 1 : 0);
