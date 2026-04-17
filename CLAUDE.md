# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
python app.py              # serves on 0.0.0.0:$PORT (default 8501)
PORT=8080 python app.py    # override port
```

The app must be run on a login/compute node with `scontrol` and `squeue` on `PATH` — it shells out to Slurm CLI tools. There are no tests, build step, or lint config.

## Architecture

Three-layer structure: a single Python module parses Slurm output, a FastAPI wrapper exposes three JSON endpoints, and a vanilla-JS single-page UI polls them.

**`slurm_parser.py`** — the only non-trivial code. Pure functions around three cached entry points (30s TTL): `get_gpu_status`, `get_cpu_status`, `get_user_jobs`. All three shell out to Slurm commands (`scontrol -a show nodes`, `squeue`) and parse the text output with regex. Key invariants:

- The `accessible` flag on each node/group (what the UI's "Accessible only" filter keys off of) is auto-detected by `_get_accessible_partitions`: it matches the current `$USER`'s OS groups (`id -Gn`) and Slurm accounts (`sacctmgr show assoc`) against each partition's `AllowGroups`/`AllowAccounts`/`DenyAccounts` from `scontrol show partition`. Cached for 5 minutes. Override with `$SLURM_DASHBOARD_ACCESSIBLE_PARTITIONS=comma,sep,list`. If detection yields an empty set (e.g. sacctmgr unavailable), every node is treated as accessible — graceful degradation rather than hiding everything.
- `GPU_PRIORITY` and `CPU_PRIORITY` list hardware tiers in descending performance order. `_detect_gpu_type` / `_detect_cpu_type` scan `ActiveFeatures` against these lists and pick the first match, so **list order is the sort order** shown in the UI. Adding new hardware means inserting at the correct tier position, not appending.
- GPU nodes (non-zero `Gres=gpu:…`) are tracked separately from CPU-only capacity. `_parse_nodes` filters to GPU nodes only (drops `gpu_total==0`); `_parse_cpu_nodes` keeps everything with CPUs. A GPU node therefore appears in *both* the GPU and CPU views.
- GPU availability timeline (`next_gpu_free_at`, `all_gpus_free_at`, `running_jobs`) comes from cross-referencing running-job end times from `squeue` against node allocations — jobs with `end_time=N/A` (no time limit) are excluded because they never free up.
- User jobs are grouped by `_classify_job_group` into `running` / `scheduled` (PENDING with a real `StartTime`) / `pending` (PENDING with unknown start) / `other`. Pending jobs are sorted by priority desc then submit time, and get a `rank` field (1-indexed queue position).

**`app.py`** — thin FastAPI shim. Three endpoints (`/api/gpu-status`, `/api/cpu-status`, `/api/user-jobs`) directly return the parser dicts; `/` renders the single template. The `get_user_jobs` endpoint reads `$USER` server-side, so it returns jobs for whoever ran `python app.py`.

**`templates/index.html` + `static/app.js` + `static/style.css`** — one page, three tabs (GPU / CPU / My Jobs) switched client-side. Tailwind is loaded from CDN. Tabs fetch on activation and auto-refresh on a 30s interval that matches the server cache TTL.

## Skills

`skills/slurm/` contains a self-contained Slurm job-management skill (`SKILL.md` + `cpu-groups.md` + `unblock-backfill.md`). It is **cluster-agnostic** by design — no partitions, accounts, or GPU types are hardcoded. If you edit it, preserve that property; cluster-specific overrides belong in a separate overlay skill, not here.
