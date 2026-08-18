# Tessa Inventory Automation — Master Resume Doc

Single source of truth for the project. Nothing is built in n8n yet — everything below
is planned, decided, and sequenced. Use this to continue in a new chat.

---

## 1. The project

Build an inventory-automation agent for **Tessa SpA's botillerías** (3 stores in
Iquique), on **n8n** as the workflow backbone. This is one piece of the larger goal of
**owner-absent, AI-run store operations**. More workflows get added to the same backbone
later.

What the agent must do (the original six points):
1. Reconciliation — expected stock vs physical count → variance
2. Cycle-count dispatch — 5 products/day per store, rotating
3. Price checks
4. Reorder alerts to Telegram
5. Two-way Telegram communication
6. Telegram slash commands (`/inventario`, `/precio`, `/venta`, `/kardex`, …)

---

## 2. Decisions locked in (and why)

- **Data comes from ControlVentas.cl exports dropped into Google Drive — no API.**
  ControlVentas is a closed cloud POS with no public API, so the bridge is
  report export → Drive → n8n reads the file. The workflow reads *files*, not a live DB.
- **Math in Code nodes, never in the LLM.** LLMs miscount. The AI agent is only for
  writing messages and routing Telegram commands.
- **Variance = system stock − physical count.** Use ControlVentas' own valorized stock
  as "expected" instead of recomputing `mother − sales` (fewer moving parts). The
  `mother − sales` version is kept only as an optional audit to catch unregistered sales.
- **All Drive files share one product key (SKU / código de barras).** Non-negotiable —
  the reconciliation Merge lines up on it.
- **Two separate flows, not one** (different triggers / lifecycles) — see section 3.
- **Don't rebuild what the POS already has.** ControlVentas includes "Consultor de
  Precios" and "Stock Crítico" natively. The agent's unique value is reconciliation,
  cross-store view, and the Telegram layer.
- **Telegram messages: plain text, no emoji.** 4096-char limit — split or send as a
  file if long.

---

## 3. Workflow maps

### Flow A — daily engine (scheduled; produces and pushes the reports)

```
[Schedule trigger]            runs daily
        |
        v
[Read Drive files]            stock, ventas, conteo
        |
        v
[Merge by SKU]                lines up all three per product
        |
        v
[Calc core (Code node)]  -->  outputs: variances[], reorders[], price_flags[]
        |
        v
[AI agent]                    writes the messages (language only)
        |
        v
[Telegram per store]          one report per store

  Parallel branch off the schedule:
[Cycle-count dispatch]        5 rotating SKUs per store per day  -->  Telegram
```

### Flow B — always-on Telegram command listener (reacts on demand)

```
[Telegram trigger]            listens for slash commands
        |
        v
[Switch]                      routes by command
        |
        v
[Query data]                  pulls the relevant data
        |
        v
[AI agent]                    formats the answer (language only)
        |
        v
[Reply]                       sends back to Telegram
```

Both flows share the same data (Drive files keyed by SKU) and the same
AI-for-wording-only rule. Flow A pushes; Flow B reacts.

---

## 4. What the AI agent does (and does not)

The AI handles **language only**. Four jobs:
- **Write store reports** — turns the variance/reorder lists into plain text.
- **Format command replies** — turns query results into readable answers.
- **Route commands** — reads `/inventario`, `/precio`, `/venta`, etc.
- **Two-way chat** — answers follow-up questions.

**Not the AI's job** — reconciliation, counting, variance and reorder math all stay in
Code nodes. The money math is deterministic and auditable; the AI can't get a number
wrong because it never touches numbers.

---

## 5. Deployment phases (build order)

| Phase | What | Status |
|-------|------|--------|
| **1. Foundation setup** | n8n running, Drive + Telegram connected, file format agreed | ⏳ Start here |
| **2. Calc core node** | the Code node that outputs variances, reorders, price flags | Next |
| **3. Flow A reports** | schedule → read → merge → calc → AI → Telegram per store | |
| **4. Cycle-count branch** | dispatch 5 rotating SKUs per store each day | |
| **5. Flow B commands** | Telegram slash-command listener, one command at a time | |
| **6. Go live** | real data, real schedule, error handling, monitoring | |

Each phase produces something testable before the next begins.

---

## 6. Phase 1 — Foundation setup, step by step

1. **Stand up n8n.** Recommended: **n8n Cloud** (hosted, auto-updated, low-maintenance —
   good for owner-absent). Alternative: **self-host** via Docker on a small VPS. This is
   the only real fork; everything after is identical.
2. **Create the Telegram bot.** Message `@BotFather` → `/newbot` → copy the token.
   Create the store group/chat, add the bot, grab the chat ID.
3. **Connect credentials in n8n.** Add a Telegram credential (token) and a Google Drive
   credential (OAuth). Test both connections.
4. **Set up the Drive folder.** One folder for exports; fixed filenames, e.g.
   `stock.csv`, `ventas.csv`, `conteo.csv`.
5. **Confirm the SKU column.** Same product-key column name across all three exports.
   Non-negotiable — the merge depends on it.
6. **Drop in a real sample day.** One actual day of stock, ventas, and a conteo file
   from ControlVentas, so Phase 2 is built against real shapes.

**Blocks Phase 2:** the exact SKU column name (step 5) and the reorder rule (fixed
minimum vs velocity-based).

---

## 7. Open decisions (still to finalize)

- **Hosting** — n8n Cloud vs self-hosted (blocks Phase 1 step 1).
- **SKU column** — exact column name in each export (blocks Phase 2).
- **Reorder rule** — fixed minimum per product, or sales-velocity based (blocks Phase 2).
- **Cadence** — daily only, or also an intraday check?
- **Price check** — keep in n8n, or leave it to ControlVentas?
- **Message style** — one summary per store, or separate variance vs reorder messages?
- **Count rollout** — which stores run the physical count now (the "2 vs 3" question)?
- **Final Flow B command list.**

---

## 8. Immediate next step

Finish **Phase 1**, then write the **Calc core Code node** (Phase 2) against the sample
files — the node that takes the merged rows (stock + sales + count per SKU) and outputs
`variances[]`, `reorders[]`, and `price_flags[]`. Everything else hangs off it.

To continue in a new chat: attach this file, then say *"Read this and let's continue —
here's my SKU column name and reorder rule."*
