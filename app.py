"""FastAPI entry point for the Slurm Dashboard."""

import os

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from slurm_parser import get_cpu_status, get_gpu_status

app = FastAPI(title="Slurm Dashboard")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/gpu-status")
async def gpu_status():
    return get_gpu_status()


@app.get("/api/cpu-status")
async def cpu_status():
    return get_cpu_status()


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8501))
    uvicorn.run(app, host="0.0.0.0", port=port)
