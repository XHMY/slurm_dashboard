"""FastAPI entry point for the Slurm Dashboard."""

import os

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from slurm_parser import get_cpu_status, get_gpu_status, get_storage_status, get_user_jobs

app = FastAPI(title="Slurm Dashboard")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# These handlers are deliberately sync `def`, not `async def`. They shell out to
# Slurm CLI tools / df / du via blocking subprocess calls. FastAPI runs sync path
# operations in a threadpool, so a slow request (e.g. storage scanning many
# mounts) stays on its own worker thread and never blocks the event loop — other
# tabs keep responding while it loads. Declaring them `async def` would pin the
# blocking work to the single event-loop thread and serialize every request.
@app.get("/api/gpu-status")
def gpu_status():
    return get_gpu_status()


@app.get("/api/cpu-status")
def cpu_status():
    return get_cpu_status()


@app.get("/api/user-jobs")
def user_jobs():
    return get_user_jobs()


@app.get("/api/storage-status")
def storage_status(force: bool = False):
    return get_storage_status(force=force)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8501))
    uvicorn.run(app, host="0.0.0.0", port=port)
