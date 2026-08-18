# Tessa inventory agent — install guide

Built 2026-08-03 from `tessa-inventory-automation-MASTER.md`. Target n8n:
**https://n8n.136.65.229.48.sslip.io** (self-hosted, GCP — see the `n8n-gcp-setup` memory).

The master doc's Phase 1 fork ("n8n Cloud vs self-hosted") is already settled — the
self-hosted instance is live, so Phase 1 step 1 is done.

## Files

| File | What |
|---|---|
| `flow-a-daily-engine.workflow.json` | Flow A — 20 nodes. Schedule → Drive + counts table → merge → Calc core → Telegram, plus the cycle-count branch and the daily heartbeat. |
| `flow-b-telegram-commands.workflow.json` | Flow B — 10 nodes. Telegram trigger → Drive → command router → (count? save to table) → reply. |
| `flow-c-error-alerts.workflow.json` | Flow C — 4 nodes. Error trigger → format → Telegram to the owner. |
| `build-workflows.js` | Generates all three JSONs. **Edit this, not the JSON**, then re-run `node build-workflows.js`. |
| `test-code-nodes.js` | Runs the Code nodes against fake ControlVentas rows outside n8n. `node test-code-nodes.js` — 64 checks. |

## Status: INSTALLED 2026-08-03

All three are already live on the instance. Verified by executing the deployed
`Calc core` code server-side against test rows — it returned the correct `$2.580`.

| Workflow | ID | Active |
|---|---|---|
| Flow A — Daily inventory engine (20 nodes) | `4qLbrmj4qVw2IvBt` | no (run manually first) |
| Flow B — Telegram commands (10 nodes) | `X8i5oIr3MtQ8s96N` | no (activate after credentials) |
| Flow C — Error alerts | `wKD3OtqFDruqFZzQ` | n/a (error trigger) |

Flow C is already wired as the Error Workflow on A and B — no manual step needed.

Re-import is only needed if you change `build-workflows.js`.

## Import (only if re-importing)

**Option A — UI (no secrets shared).** Open n8n → *Workflows* → *Import from File* →
pick each `.workflow.json`. Repeat for all three.

**Option B — API.** Create a key at *Settings → n8n API*, then:

```bash
cd tessa-automation
for f in flow-a-daily-engine flow-b-telegram-commands flow-c-error-alerts; do
  curl -s -X POST https://n8n.136.65.229.48.sslip.io/api/v1/workflows \
    -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'Content-Type: application/json' \
    --data-binary @$f.workflow.json | head -c 200; echo
done
```

## After import — the five things that are placeholders

1. **Google Drive folder id** — in every node named `Find *.csv` (3 in Flow A, 1 in
   Flow B). Replace `REPLACE_WITH_DRIVE_FOLDER_ID`.
2. **Telegram chat ids** — inside the `CONFIG` block at the top of the Code nodes
   `Calc core`, `Cycle count dispatch`, `Command router`. Replace
   `REPLACE_CHAT_ID_1..3`, and make the keys (`LOCAL 1`…) match the exact values in
   the store column of the exports.
3. **Owner chat id** — `REPLACE_OWNER_CHAT_ID`, in **two** places: Flow C's
   `Format the alert` node and Flow A's `Heartbeat` node.
4. **Credentials** — attach a Google Drive OAuth credential to the Drive nodes and a
   Telegram credential (BotFather token) to the Telegram nodes.
5. **CSV delimiter** — the `CSV *` nodes are set to `;`. Check a real ControlVentas
   export; switch to `,` if needed.

Flow C is **already wired** as the Error Workflow on A and B. Do not set Flow C as its
own error workflow — a failure there would loop.

Then:
- **Activate Flow B** (toggle, top right) so Telegram registers the webhook.
- Flow A can stay inactive until you've run it once manually.

## The two blockers from the master doc — how they're handled

- **SKU column name.** Not a blocker anymore. `CONFIG.skuColumns` is a candidate list
  (`sku`, `codigo`, `código de barras`, `ean`, …); the first one present in the header
  wins, exact match first, then substring. If none match, the node throws an error that
  *prints the actual header row* so you can add the real name. Same approach for name,
  stock, count, sold, price, minimum and store columns.
- **Reorder rule.** Both are implemented; `CONFIG.reorderRule` switches between them.
  - `'fixed'` (default) — reorder when `stock <= minimo` column, falling back to
    `CONFIG.minDefault` (6) when the export has no minimum column.
  - `'velocity'` — reorder when `stock < sold * CONFIG.coverDays` (7).

## Design notes

- **No AI node yet, on purpose.** The Code nodes emit a finished plain-text `report`,
  so the flows work with zero LLM credentials and zero token cost. A sticky note in
  Flow A marks where an AI Agent node slots in between `Calc core` and Telegram, once
  you want the wording rewritten. The master doc's rule holds either way: the AI never
  touches numbers.
- **Merge node before the Calc core** rather than referencing branches directly — it
  guarantees all three CSVs have been read before the math runs.
- **Chilean number parsing.** `1.290` is 1290, not 1.29. This was a real bug caught by
  the test harness — the first version reported $3 of shrinkage where the truth was
  $2.580. `num()` treats dots as thousands separators when every group after the first
  is exactly three digits, and handles `1.234,56`, `$`, and `(1.234)` negatives.
- **Telegram 4096-char limit** — every generated message is truncated at 3890.
- **Plain text, no emoji**, per the master doc.
- **Degradation is deliberate.** Every Drive node retries 3× and then emits an empty
  item instead of throwing. A missing `conteo.csv` still produces the reorder report
  (just with no variances); a missing `ventas.csv` still produces variances. Only a
  missing `stock.csv` is fatal, and it fails with a message that says so. Tested.

## The count loop — closed

The cycle-count message asks each store to reply `SKU cantidad`, one product per line.
Flow B now recognises those replies, writes them to the **`conteos` n8n Data Table**
(id `ZWzp8b3WkpfVMbGh`, columns `sku, store, qty, counted_at, reported_by`) and confirms
back. Flow A reads that table as its **primary** count source; `conteo.csv` is only the
fallback when the table is empty. Nobody re-types counts.

Details that matter:
- A store re-sending a corrected count wins — Flow A keeps the newest `counted_at` per
  SKU + store.
- The store is resolved from the Telegram chat id via `CONFIG.stores`, falling back to
  the group title.
- Ordinary chat is not swallowed: a message only counts if most of its lines parse as
  `SKU cantidad`. `7801: 22` and `7801 - 22` also work.
- Unknown SKUs and unparseable lines are called out in the confirmation rather than
  silently dropped.

## The dead-man's switch

Flow A sends one "Motor de inventario OK" message to the owner after the store reports
go out, summarising locales processed, products counted, total variances in pesos and
reorder count. **If that message stops arriving, the automation stopped running** — a
dead VM produces no error alert, so this is the only signal that would catch it.

## What's still open

- **Not validated against real data.** All 64 checks run against fabricated rows with
  guessed Spanish headers. The first real export may need column names added to
  `CONFIG` — the error message will name the actual header.
- **No AI wording layer** (deliberate — see design notes).

## Phase status

| Phase | Status |
|---|---|
| 1. Foundation | n8n live; Drive folder + Telegram bot + credentials still to attach |
| 2. Calc core node | **Done** — written, tested, and verified running on the server |
| 3. Flow A reports | **Done** — needs a real sample day to validate |
| 4. Cycle-count branch | **Done** — 5 rotating SKUs/store/day, day-of-year rotation |
| 5. Flow B commands | **Done** — commands + count-reply ingestion |
| 6. Go live | **Done except credentials** — error alerts, retry/degrade, count loop and heartbeat all built and deployed |

Next real-world step is master-doc Phase 1 step 6 — drop one actual day of
`stock.csv` / `ventas.csv` into the Drive folder and run Flow A once manually. The column
auto-detection either finds everything or tells you exactly which header to add.
