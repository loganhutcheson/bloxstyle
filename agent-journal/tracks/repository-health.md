# Repository health

## 2026-07-28 — Raspberry Pi checkout and baseline exploration

- Cloned `main` at `ea39381` and verified that the current working tree is about
  7 MB while `.git` contains a 1.66 GiB pack.
- The slow clone was caused by 301 historical LoRA `.safetensors` checkpoints
  totaling about 1.80 GiB uncompressed. They were deleted from the tip in
  `4ad5e8d` but remain in history.
- The Pi is connected at 1 Gbit/s full-duplex Ethernet with a clean local link,
  but its upstream path includes a wireless hop. During clone, GitHub latency
  averaged about 238 ms and transfer throughput was about 35 Mbit/s.
- Indexed the web app, inference/training code, deployment paths, environment
  contract, verification commands, and cleanup risks in `CODEBASE_INDEX.md`.
- Python sources compile successfully. Web lint/type/build checks were not run:
  dependencies are absent, the Pi has Node 22 while the project requires Node
  24, and the production build also needs `DATABASE_URL`.

### Recommended first cleanup commit

Make one non-behavioral repository-hygiene commit that removes the tracked
`web/prisma/dev.db` and `web/prisma/dev.db-journal`, ignores Prisma SQLite
scratch files, replaces the placeholder READMEs with accurate setup and
architecture documentation, and repairs stale paths/runtime notes in
`AGENTS.md`. Keep the disruptive checkpoint history rewrite separate so it can
be coordinated and rolled out safely.

### Follow-ups

- Install/use Node 24, install dependencies, and establish a clean lint,
  typecheck, and build baseline.
- Design an idempotent Stripe credit ledger before changing payment behavior.
- Decide where the final LoRA artifact belongs, install `git-filter-repo` and
  Git LFS if chosen, then coordinate a history rewrite and fresh clones.

## 2026-08-02 — Repository classification cleanup

- Reorganized the checkout around operational status: `web/` remains the live Vercel app, the active Qwen ComfyUI definition moved to `modal/qwen/image-edit.json`, stopped SD1.5 work moved to `archive/sd15/`, and FLUX/SD3.5/SDXL experiments moved to `archive/experiments/`.
- Moved unused historical root assets to `archive/assets/`; no datasets, weights, generated output, or Git history were deleted.
- Updated the archived Modal app, FastAPI service, Docker entrypoint, and inference defaults for their new paths. The archived Modal app still reads the ignored final LoRA from the repository-level `weights/` directory.
- Replaced the long handoff in `AGENTS.md` with a short repository map and journal rule. Added focused READMEs at the root, `modal/qwen/`, and `archive/`, and refreshed `CODEBASE_INDEX.md`.
- Verified `python3 -m compileall -q archive`, `npm run lint`, and `npx tsc --noEmit`. Web lint completed with the existing 12 warnings and no errors; type-check passed.
- Remaining cleanup should be separate and explicit: remove tracked Prisma SQLite scratch files, decide whether to keep the archived source-asset tar/OBJ, and coordinate a Git history rewrite if reducing clone size is worth the disruption.

## 2026-07-28 — WAN priority benchmark

- Before the WAN priority adjustment, a repeat clone reached 1.08 GiB in 375
  seconds, sustained roughly 2–3 MiB/s, and produced about 98 ms average GitHub
  latency under load.
- After the priority adjustment, the same full `--no-checkout` clone downloaded
  the 1.66 GiB pack in 75.421 seconds. A concurrent sample measured 26.50 MiB/s
  (222.3 Mbit/s), 26.969 ms average GitHub latency, 0.117 ms jitter, and 0%
  packet loss.
- The priority change eliminated the observed download queueing and improved
  clone time by at least 5x. The temporary benchmark checkout was removed.
