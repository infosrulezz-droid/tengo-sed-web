# Tessa Inventory Automation — Handoff Package

Drop this whole folder (or the master file) into a new chat to continue the build.

## What's in here

- **`tessa-inventory-automation-MASTER.md`** — read this first. The complete project
  state in one document: goal, decisions locked in, workflow maps, AI role, the six
  phases, Phase 1 deploy steps, and open decisions.
- **`diagrams/`** — the four flow charts as standalone SVGs you can open in any browser:
  - `flow-a-daily-engine.svg`
  - `flow-b-telegram-listener.svg`
  - `ai-agent-functions.svg`
  - `deployment-phases.svg`

## How to resume in a new chat

1. Attach `tessa-inventory-automation-MASTER.md` (and the diagrams if you want them).
2. Say: "Read this and let's continue from where we are."
3. The current stopping point is **Phase 1 — Foundation setup**, then **Phase 2 —
   write the Calc core node**. The two things that unblock Phase 2 are:
   - the exact **SKU column name** in the ControlVentas exports, and
   - the **reorder rule** (fixed minimum per product vs sales-velocity based).

## The one open deploy decision

Hosting: **n8n Cloud** (recommended — hosted, low-maintenance) vs **self-hosted**
(Docker on a VPS). Everything after this choice is identical.
