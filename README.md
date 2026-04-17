# Slurm Dashboard

A lightweight web dashboard for monitoring Slurm cluster GPU/CPU availability and your own jobs. FastAPI backend + vanilla-JS single-page UI.

## Requirements

- Access to a Slurm login or compute node with `scontrol`, `squeue`, `sacctmgr`, and `id` on `PATH`
- `pip install fastapi uvicorn jinja2`

## Usage

```bash
python app.py              # serves on 0.0.0.0:8501
PORT=8080 python app.py    # override port
```

Then open `http://<host>:8501` in a browser.

## Features

Three tabs, each auto-refreshing every 30s:

- **GPU** — per-node GPU availability, grouped by hardware tier, with next-free timestamps from running jobs.
- **CPU** — per-node CPU capacity, grouped by CPU model.
- **My Jobs** — your running, scheduled, and pending jobs (uses `$USER` of the process running `app.py`).

Toggle **Accessible only** to filter nodes to partitions you can actually submit to. Accessibility is auto-detected from your OS groups and Slurm accounts against each partition's `AllowGroups`/`AllowAccounts`/`DenyAccounts`.

## Configuration

| Env var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `8501`) |
| `SLURM_DASHBOARD_ACCESSIBLE_PARTITIONS` | Comma-separated partition list to override auto-detection |

## API

JSON endpoints (30s server-side cache):

- `GET /api/gpu-status`
- `GET /api/cpu-status`
- `GET /api/user-jobs`

## Layout

```
app.py              FastAPI app + 3 endpoints
slurm_parser.py     Shells out to Slurm CLI and parses output
templates/          index.html
static/             app.js, style.css
skills/slurm/       Cluster-agnostic job-management skill
```
