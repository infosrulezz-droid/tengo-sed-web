// Runs calc-core-v2 against REAL ControlVentas exports (via fixtures.json) plus
// unit checks on the number parsers. `node test-calc-core-v2.js`
const path = require('path');
const fs = require('fs');
const { qty, money, keysOf, calcStore, CONFIG, nameKey, byName } = require('./calc-core-v2.js');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = Object.is(actual, expected);
  if (ok) { pass++; }
  else { fail++; console.log('  FAIL ' + label + ' -> got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)); }
}
function ok(cond, label) {
  if (cond) pass++; else { fail++; console.log('  FAIL ' + label); }
}

console.log('--- qty(): ControlVentas quantity format ---');
// The bug that mattered: lone dot is a DECIMAL point, not a thousands sep.
eq(qty('1.000'), 1, 'qty 1.000 -> 1');
eq(qty('6.000'), 6, 'qty 6.000 -> 6');
eq(qty('2.000'), 2, 'qty 2.000 -> 2');
eq(qty('22,000'), 22, 'qty 22,000 -> 22');
eq(qty('-56,000'), -56, 'qty -56,000 -> -56');
eq(qty('3.876,000'), 3876, 'qty 3.876,000 -> 3876');
eq(qty('-11.473,000'), -11473, 'qty -11.473,000 -> -11473');
eq(qty(''), 0, 'qty empty -> 0');
eq(qty(null), 0, 'qty null -> 0');
eq(qty(42), 42, 'qty number passthrough');
eq(qty('1.5'), 1.5, 'qty 1.5 -> 1.5');

console.log('--- money(): pesos ---');
eq(money('4500'), 4500, 'money 4500');
eq(money('178000'), 178000, 'money 178000');
eq(money('12.990'), 12990, 'money 12.990 -> 12990 (hand-edited file)');
eq(money('1.234,56'), 1234.56, 'money 1.234,56');
eq(money('-611'), -611, 'money negative');
eq(money(''), 0, 'money empty');

console.log('--- keysOf(): multi-barcode products ---');
eq(keysOf('7796776377967602/77989086').length, 2, 'two barcodes split');
eq(keysOf('78007505/78068315/78005624').length, 3, 'three barcodes split');
eq(keysOf('PROD-XWNDHVRL')[0], 'PROD-XWNDHVRL', 'internal code kept');
eq(keysOf('')[0], undefined, 'empty -> no keys');
eq(keysOf(' 7804330352111 ')[0], '7804330352111', 'trimmed');

console.log('--- calcStore() against REAL exports ---');
const fx = path.join(__dirname, 'fixtures.json');
if (!fs.existsSync(fx)) {
  console.log('  SKIP — fixtures.json not present (run make_fixtures.py first).');
} else {
  const data = JSON.parse(fs.readFileSync(fx, 'utf8'));

  for (const [slug, store] of [['tengo_sed', 'Tengo Sed'], ['los_negros', 'Los Negros']]) {
    const d = data[slug];
    console.log('\n  === ' + store + ' ===');
    const res = calcStore(store, d.inventory, d.sales, []);

    ok(res.products > 500, store + ': read a realistic product count (' + res.products + ')');
    ok(res.revenue > 100000 && res.revenue < 100000000,
       store + ': revenue in a sane range -> ' + res.revenue);
    ok(res.reorders.length > 0, store + ': produced reorder suggestions');
    ok(res.negatives.length > 0, store + ': surfaced negative stock');
    ok(res.report.length > 100, store + ': produced a report');
    ok(res.report.length <= 3890 + 20, store + ': report within Telegram limit');

    // The 1000x regression guard: no reorder may suggest an absurd quantity.
    const absurd = res.reorders.filter(r => r.sold > 5000);
    eq(absurd.length, 0, store + ': no product shows >5000 units sold in a day');

    console.log('    products=' + res.products +
                ' revenue=' + res.revenue +
                ' reorders=' + res.reorders.length +
                ' negatives=' + res.negatives.length +
                ' stockValue=' + Math.round(res.stockValue));
    console.log('    top sellers driving reorder:');
    for (const r of res.reorders.slice(0, 3)) {
      console.log('      ' + r.name + ' | stock ' + r.stock + ' | sold ' + r.sold + ' | pedir ' + r.suggest);
    }
  }

  // Daily dispatch: 10 negatives + 5 count items per store, rotating by day.
  console.log('\n  === daily dispatch ===');
  for (const [slug, store] of [['tengo_sed', 'Tengo Sed'], ['los_negros', 'Los Negros']]) {
    const d = data[slug];
    const res = calcStore(store, d.inventory, d.sales, []);
    eq(res.negativesBatch.length, 8, store + ': exactly 8 negatives dispatched');
    eq(res.countBatch.length, 8, store + ': exactly 8 count items dispatched');
    ok(res.negativesBatch.every(n => n.stock < 0), store + ': every dispatched item really is negative');
    ok(res.negativesTask.includes('SKU cantidad'), store + ': negatives message explains the reply format');
    ok(res.countTask.includes('CONTEO DEL DIA'), store + ': count message is labelled');
    ok(res.negativesTask.length <= 3890, store + ': negatives message fits Telegram');
    ok(res.countTask.length <= 3890, store + ': count message fits Telegram');
    // No bucket may be handed out to count — counting "Suelto 1f" is pointless.
    const bucketNames = ['suelto', 'vaso', 'brandy', 'encendad', 'encended'];
    ok(!res.countBatch.some(p => bucketNames.some(b => p.name.toLowerCase().includes(b))),
       store + ': no catch-all bucket in the count list');
  }

  // Alphabetical order, with numeric-prefixed names filed under their letter.
  console.log('\n  === alphabetical ordering ===');
  eq(nameKey('120  CAB.SOV'), 'cab.sov', '"120 CAB.SOV" files under C');
  eq(nameKey('120  Tinto 500 ML'), 'tinto 500 ml', '"120 Tinto" files under T');
  eq(nameKey('Brandy'), 'brandy', 'plain name unchanged');
  eq(nameKey('7801620001643'), '7801620001643', 'all-digits name falls back to raw');
  {
    const sorted = [
      { name: '120  Tinto 500 ML' }, { name: 'Brandy' }, { name: '120  CAB.SOV' },
      { name: 'Absolut' }, { name: 'Vaso' },
    ].sort(byName).map(p => p.name);
    // a-b-c-t-v by first letter: Absolut, Brandy, CAB.SOV, Tinto, Vaso —
    // the two "120 ..." products land under C and T, not bunched at the front.
    eq(sorted.join(' | '),
       'Absolut | Brandy | 120  CAB.SOV | 120  Tinto 500 ML | Vaso',
       'numeric-prefixed products interleave with the letters');
  }
  {
    const res = calcStore('Tengo Sed', data.tengo_sed.inventory, data.tengo_sed.sales, []);
    const keys = res.countBatch.map(p => nameKey(p.name));
    const asc = keys.slice().sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    // A rotated window wraps at most once, so it is ascending except for one seam.
    let seams = 0;
    for (let i = 1; i < keys.length; i++) if (keys[i].localeCompare(keys[i-1], 'es') < 0) seams++;
    ok(seams <= 1, 'daily count list is alphabetical (at most one wrap seam)');
    ok(asc.length === keys.length, 'count batch keys all resolve');
  }

  // Saturday must be skipped WITHOUT dropping that day's products.
  console.log('\n  === saturday off, no products lost ===');
  {
    const { workingDayIndex, saturdaysUpTo, isSaturday } = require('./calc-core-v2.js');
    eq(saturdaysUpTo(0), 0, 'no saturdays before epoch day 0');
    eq(saturdaysUpTo(2), 1, '1970-01-03 was the first Saturday');
    eq(saturdaysUpTo(9), 2, 'two Saturdays by 1970-01-10');
    ok(isSaturday(new Date('2026-08-08T12:00:00Z')), '2026-08-08 is a Saturday');
    ok(!isSaturday(new Date('2026-08-09T12:00:00Z')), '2026-08-09 is a Sunday');
    // Fri -> Sat -> Sun: the working index must advance by exactly 1, not 2,
    // otherwise the Saturday slice of products is skipped forever.
    const fri = workingDayIndex(new Date('2026-08-07T12:00:00Z'));
    const sat = workingDayIndex(new Date('2026-08-08T12:00:00Z'));
    const sun = workingDayIndex(new Date('2026-08-09T12:00:00Z'));
    eq(sun - fri, 1, 'Fri -> Sun advances the working day by exactly 1');
    eq(sat, fri, 'Saturday shares the previous working index (nothing skipped)');
  }

  // Reply-driven batching: repeat until answered, then advance.
  console.log('\n  === reply-driven batching ===');
  {
    const { calcStore: cs } = require('./calc-core-v2.js');
    const list = Array.from({ length: 20 }, (_, i) => ({ sku: 'S' + String(i).padStart(2, '0'), name: 'Prod ' + i }));
    // exercise nextBatch through a tiny harness mirroring real use
    const nb = require('./calc-core-v2.js').nextBatch;

    const r1 = nb(list, undefined, new Set(), 8);
    eq(r1.batch.length, 8, 'first run sends 8');
    eq(r1.resent, false, 'first run is not a resend');
    eq(r1.state.cursor, 8, 'cursor advanced to 8');

    // Nobody replied -> exactly the same 8 come back.
    const r2 = nb(list, r1.state, new Set(), 8);
    eq(r2.batch.map(p => p.sku).join(','), r1.batch.map(p => p.sku).join(','), 'no reply -> identical batch repeats');
    eq(r2.resent, true, 'repeat is flagged as resent');
    eq(r2.state.cursor, 8, 'cursor does NOT advance while unanswered');

    // Partial reply -> only the unanswered ones repeat, no new items added.
    const partial = new Set(r1.batch.slice(0, 5).map(p => p.sku));
    const r3 = nb(list, r2.state, partial, 8);
    eq(r3.batch.length, 3, 'partial reply -> only the 3 outstanding repeat');
    ok(r3.batch.every(p => !partial.has(p.sku)), 'answered items are not repeated');
    eq(r3.state.cursor, 8, 'cursor still held');

    // Full reply -> advance to the next 8, none repeated.
    const all = new Set(r1.batch.map(p => p.sku));
    const r4 = nb(list, r3.state, all, 8);
    eq(r4.batch.length, 8, 'cleared -> a fresh 8');
    eq(r4.resent, false, 'fresh batch is not a resend');
    ok(r4.batch.every(p => !all.has(p.sku)), 'new batch has no previously answered item');
    eq(r4.state.cursor, 16, 'cursor advanced to 16');

    // Wrap-around and full coverage over repeated cleared cycles.
    let st = undefined; const seen = new Set();
    for (let i = 0; i < 10; i++) {
      const r = nb(list, st, new Set((st && st.pending) || []), 8);
      r.batch.forEach(p => seen.add(p.sku));
      st = r.state;
    }
    eq(seen.size, list.length, 'clearing every batch eventually covers all products');

    // Ghost products (deleted from the catalogue) must not deadlock the loop.
    const ghost = nb(list, { cursor: 8, pending: ['GONE1', 'GONE2'] }, new Set(), 8);
    eq(ghost.resent, false, 'vanished products do not trap the batch');
    eq(ghost.batch.length, 8, 'it moves on with a real batch');

    eq(nb([], undefined, new Set(), 8).batch.length, 0, 'empty catalogue is safe');
    eq(nb(list.slice(0, 3), undefined, new Set(), 8).batch.length, 3, 'catalogue smaller than batch is safe');
  }

  // Reading the store's replies, including photo captions.
  console.log('\n  === reply parsing (text + photo caption) ===');
  {
    const { parseCountReply, buildCountConfirmation, buildPhotoNeedsCaption } =
      require('./calc-core-v2.js');
    const known = new Set(['7801620001643', 'PROD-XWNDHVRL', '644536226611']);

    const p1 = parseCountReply('7801620001643 22', known);
    eq(p1.counts.length, 1, 'space separator parses');
    eq(p1.counts[0].qty, 22, 'quantity read');
    ok(p1.isCountReply, 'single valid line is a count reply');

    eq(parseCountReply('7801620001643: 22', known).counts[0].qty, 22, 'colon separator');
    eq(parseCountReply('7801620001643 - 22', known).counts[0].qty, 22, 'dash separator');
    eq(parseCountReply('7801620001643=22', known).counts[0].qty, 22, 'equals separator');
    eq(parseCountReply('7801620001643 x22', known).counts[0].qty, 22, 'x separator');
    eq(parseCountReply('7801620001643 22 unidades', known).counts[0].qty, 22, 'trailing unit word');
    eq(parseCountReply('PROD-XWNDHVRL 0', known).counts[0].qty, 0, 'zero is a valid answer');

    const multi = parseCountReply('7801620001643 5\nPROD-XWNDHVRL 0\n644536226611 12', known);
    eq(multi.counts.length, 3, 'three lines parse');
    ok(multi.isCountReply, 'multi-line is a count reply');

    // Ordinary conversation must NOT be treated as counts.
    const chat = parseCountReply('hola jefe, mañana llega el pedido de corona', known);
    eq(chat.counts.length, 0, 'chat produces no counts');
    ok(!chat.isCountReply, 'chat is not a count reply');
    ok(!parseCountReply('ok', known).isCountReply, '"ok" is not a count reply');
    ok(!parseCountReply('ya lo hice gracias', known).isCountReply, 'thanks is not a count reply');

    // Mostly-chat with one number buried in it should not count either.
    const mixed = parseCountReply('hola\ncomo estas\ntodo bien\n7801620001643 5\ngracias', known);
    ok(!mixed.isCountReply, 'one count line inside 5 chat lines is not a count reply');

    // Unknown SKUs are surfaced, not silently dropped or guessed.
    const unk = parseCountReply('9999999999999 7', known);
    eq(unk.counts.length, 0, 'unknown SKU is not counted');
    eq(unk.unknown.length, 1, 'unknown SKU is reported');

    // A corrected line wins.
    const corr = parseCountReply('7801620001643 5\n7801620001643 8', known);
    eq(corr.counts.length, 1, 'duplicate SKU collapses to one');
    eq(corr.counts[0].qty, 8, 'the later correction wins');

    // Confirmation text.
    const conf = buildCountConfirmation('Tengo Sed', multi,
      [{ sku: 'S1', name: 'Producto uno' }], true);
    ok(conf.includes('RECIBIDO'), 'confirmation is labelled');
    ok(conf.includes('Foto guardada'), 'photo is acknowledged when saved');
    ok(conf.includes('FALTAN 1'), 'confirmation says what is still missing');
    ok(conf.length <= 3890, 'confirmation fits Telegram');

    const done = buildCountConfirmation('Tengo Sed', multi, [], false);
    ok(done.includes('respondiste todo'), 'says so when nothing is left');
    ok(!done.includes('Foto guardada'), 'no photo line when no photo');

    // Photo with no caption: ask, never guess.
    const ask = buildPhotoNeedsCaption('Los Negros', [{ sku: 'S9', name: 'x' }]);
    ok(ask.includes('no puedo saber'), 'refuses to guess the quantity');
    ok(ask.includes('S9 4'), 'shows a concrete example from what is open');
  }

  // Telegram Q&A commands, answered from the store's real inventory.
  console.log('\n  === telegram commands ===');
  {
    const { parseCommand, answerCommand, findProducts } = require('./calc-core-v2.js');
    const d = data.tengo_sed;

    eq(parseCommand('/stock corona').cmd, 'stock', 'command name parsed');
    eq(parseCommand('/stock corona').args, 'corona', 'arguments parsed');
    eq(parseCommand('/bajos').args, '', 'no-arg command');
    eq(parseCommand('/ayuda@Tengosed_bot').cmd, 'ayuda', 'bot suffix stripped');
    eq(parseCommand('hola'), null, 'plain text is not a command');
    eq(parseCommand('7801 22'), null, 'a count reply is not a command');

    const help = answerCommand('Tengo Sed', 'ayuda', '', d.inventory, d.sales);
    ok(help.includes('/stock'), 'help lists commands');
    ok(help.includes('SKU cantidad'), 'help explains count replies');

    const stock = answerCommand('Tengo Sed', 'stock', 'corona', d.inventory, d.sales);
    ok(stock.includes('STOCK'), 'stock answer labelled');
    ok(/corona/i.test(stock), 'stock answer mentions the product');
    ok(stock.includes('SKU:'), 'stock answer shows the SKU');
    ok(stock.length <= 3890, 'stock answer fits Telegram');

    const precio = answerCommand('Tengo Sed', 'precio', 'corona', d.inventory, d.sales);
    ok(precio.includes('venta'), 'price answer shows sale price');
    ok(precio.includes('compra'), 'price answer shows cost');

    const none = answerCommand('Tengo Sed', 'stock', 'zzzznoexiste', d.inventory, d.sales);
    ok(none.includes('No encontre'), 'missing product says so plainly');

    const noArg = answerCommand('Tengo Sed', 'stock', '', d.inventory, d.sales);
    ok(noArg.includes('Ejemplo'), 'missing argument asks for one');

    const bajos = answerCommand('Tengo Sed', 'bajos', '', d.inventory, d.sales);
    ok(bajos.includes('REPONER'), 'bajos returns the reorder list');
    ok(bajos.includes('PEDIR'), 'bajos uses the house format');
    ok(bajos.length <= 3890, 'bajos fits Telegram');

    const negs = answerCommand('Tengo Sed', 'negativos', '', d.inventory, d.sales);
    ok(negs.includes('NEGATIVO'), 'negativos returns the negative list');

    const resumen = answerCommand('Tengo Sed', 'resumen', '', d.inventory, d.sales);
    ok(resumen.includes('INVENTARIO'), 'resumen returns the report');

    const unknown = answerCommand('Tengo Sed', 'volar', '', d.inventory, d.sales);
    ok(unknown.includes('No conozco'), 'unknown command is rejected, not guessed');

    const noData = answerCommand('Tengo Sed', 'stock', 'corona', [], []);
    ok(noData.includes('No pude leer'), 'missing inventory reported honestly');

    // Multi-match must list every option rather than silently picking one.
    const cols = { sku: 'codigo', name: 'nombre', stock: 'cantidad',
                   price: 'precio_venta', cost: 'precio_compra' };
    const many = findProducts(d.inventory, cols, 'corona');
    ok(many.length > 1, 'ambiguous search finds several products');
    const listed = (stock.match(/SKU:/g) || []).length;
    eq(listed, Math.min(many.length, 20), 'every match is shown, none silently dropped');
  }

  // Stale-file nag.
  console.log('\n  === upload reminders ===');
  {
    const { buildFilesWarning } = require('./calc-core-v2.js');
    const now = new Date('2026-08-10T15:00:00Z');
    const iso = daysAgo => new Date(now.getTime() - daysAgo * 86400000).toISOString();

    const fresh = buildFilesWarning('Tengo Sed', { inventory: iso(0), ventas: iso(1) }, now);
    eq(fresh.stale, false, 'files from today/yesterday are not stale');
    eq(fresh.text, '', 'fresh files produce no nag');

    const old = buildFilesWarning('Tengo Sed', { inventory: iso(5), ventas: iso(0) }, now);
    eq(old.stale, true, '5-day-old inventory is stale');
    ok(old.text.includes('INVENTARIO'), 'nag names the inventory file');
    ok(!old.text.includes('VENTAS:'), 'fresh ventas is not nagged about');
    eq(old.invAgeDays, 5, 'age computed in days');

    const missing = buildFilesWarning('Los Negros', {}, now);
    eq(missing.stale, true, 'no files at all is stale');
    ok(missing.text.includes('no hay archivo'), 'missing file is called out');
    ok(missing.text.includes('Los Negros'), 'nag names the store');

    // The warning must lead the report, not hide at the bottom.
    const d = data.tengo_sed;
    const r = calcStore('Tengo Sed', d.inventory, d.sales, [], undefined,
                        { inventory: iso(9), ventas: iso(9) });
    ok(r.filesStale, 'calcStore surfaces staleness');
    const head = r.report.split('\n').slice(0, 6).join('\n');
    ok(head.includes('DESACTUALIZADOS'), 'stale warning appears at the top of the report');
  }

  // 17:30 reminder: only what is still open, never anything new.
  console.log('\n  === 17:30 reminder ===');
  {
    const { outstandingFrom, buildReminder } = require('./calc-core-v2.js');
    const d = data.tengo_sed;
    const run = calcStore('Tengo Sed', d.inventory, d.sales, [], undefined);
    const st = run.nextState;

    const none = new Set();
    const negOpen = outstandingFrom(st.negatives, none);
    const cntOpen = outstandingFrom(st.count, none);
    eq(negOpen.length, 8, 'nothing answered -> all 8 negatives still open');
    eq(cntOpen.length, 8, 'nothing answered -> all 8 count items still open');

    const msg = buildReminder('Tengo Sed', negOpen, cntOpen);
    ok(msg.includes('RECORDATORIO'), 'reminder is labelled');
    ok(msg.length <= 3890, 'reminder fits Telegram');
    // Must never contain a product that was not in the morning batch.
    const sent = new Set(run.negativesBatch.concat(run.countBatch).map(p => p.sku));
    ok(negOpen.concat(cntOpen).every(p => sent.has(p.sku)),
       'reminder only repeats products already sent at 12:30');

    // Partial replies shrink the reminder.
    const some = new Set(run.negativesBatch.slice(0, 6).map(p => String(p.sku)));
    eq(outstandingFrom(st.negatives, some).length, 2, 'answered items drop out of the reminder');

    // Everything answered -> no message at all.
    const all = new Set(run.negativesBatch.concat(run.countBatch).map(p => String(p.sku)));
    eq(buildReminder('Tengo Sed', outstandingFrom(st.negatives, all),
                                  outstandingFrom(st.count, all)), '',
       'all answered -> empty reminder (nothing is sent)');
  }

  // 8 per task, and the resend marker appears in the message text.
  console.log('\n  === batch size + resend marker ===');
  {
    const d = data.tengo_sed;
    const first = calcStore('Tengo Sed', d.inventory, d.sales, [], undefined);
    eq(first.negativesBatch.length, 8, 'negatives batch is 8');
    eq(first.countBatch.length, 8, 'count batch is 8');
    ok(!first.negativesTask.includes('REPETIDO'), 'first send is not marked repeated');

    const again = calcStore('Tengo Sed', d.inventory, d.sales, [], first.nextState);
    eq(again.negativesBatch.map(p => p.sku).join(','),
       first.negativesBatch.map(p => p.sku).join(','),
       'unanswered negatives repeat verbatim');
    ok(again.negativesTask.includes('REPETIDO'), 'repeat is visibly marked to the store');

    const replies = first.negativesBatch.map(p => ({ sku: p.sku, qty: 1 }))
      .concat(first.countBatch.map(p => ({ sku: p.sku, qty: 1 })));
    const moved = calcStore('Tengo Sed', d.inventory, d.sales, replies, first.nextState);
    ok(moved.negativesBatch.every(p => !first.negativesBatch.some(q => q.sku === p.sku)),
       'after replying, negatives move to new products');
    ok(moved.countBatch.every(p => !first.countBatch.some(q => q.sku === p.sku)),
       'after replying, count moves to new products');
  }

  // Variance path, using a count that deliberately disagrees with the system.
  console.log('\n  === variance path (synthetic count on real rows) ===');
  const ts = data.tengo_sed;
  const first = ts.inventory[0];
  const invSkuCol = Object.keys(first).find(k => k.toLowerCase() === 'codigo');
  const sysQty = Number(first['cantidad']);
  const res2 = calcStore('Tengo Sed', ts.inventory, ts.sales,
                         [{ sku: first[invSkuCol], qty: sysQty - 3 }]);
  eq(res2.counted, 1, 'exactly one product counted');
  eq(res2.variances.length, 1, 'one variance detected');
  eq(res2.variances[0].diff, -3, 'variance is -3 units');
  ok(res2.variances[0].value < 0, 'missing stock has negative value');
  ok(res2.report.includes('CONTEO FISICO'), 'report includes the count section');

  console.log('\n  === sample report (Tengo Sed) ===');
  console.log(calcStore('Tengo Sed', ts.inventory, ts.sales,
              [{ sku: first[invSkuCol], qty: sysQty - 3 }]).report
              .split('\n').slice(0, 22).map(l => '    ' + l).join('\n'));

  // Missing-file degradation.
  console.log('\n  === degradation ===');
  const noSales = calcStore('Tengo Sed', ts.inventory, [], []);
  ok(noSales.report.length > 50, 'still reports with no sales file');
  eq(noSales.revenue, 0, 'no sales -> zero revenue');
  let threw = false;
  try { calcStore('Tengo Sed', [], ts.sales, []); } catch (e) { threw = /inventario/i.test(e.message); }
  ok(threw, 'missing inventory file fails loudly');
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
