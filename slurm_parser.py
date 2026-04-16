"""Parse scontrol -a show nodes output into structured GPU/CPU availability data."""

import json
import re
import subprocess
import time
from typing import Any

_cache: dict[str, Any] = {"data": None, "timestamp": 0}
_cpu_cache: dict[str, Any] = {"data": None, "timestamp": 0}
CACHE_TTL = 30  # seconds

ACCESSIBLE_PARTITIONS = {"dgxh", "hw-grp", "preempt"}

GPU_PRIORITY = [
    "h200", "h100-40g", "h100", "l40s", "a40", "v100",
    "rtx8000", "rtx6000", "rtx2080", "gtx1080", "gtx980", "m60", "t4",
]

CPU_PRIORITY = [
    "sapphire", "epyc-el9", "epyc", "cascadelake", "skylake",
    "broadwell", "haswell", "ivybridge", "sandybridge",
]

DOWN_STATES = {"DOWN", "DRAINED", "NOT_RESPONDING", "FAIL", "FUTURE", "POWERING_DOWN", "POWERED_DOWN"}
DRAIN_STATES = {"DRAIN", "DRAINING"}


def _run_scontrol() -> str:
    result = subprocess.run(
        ["scontrol", "-a", "show", "nodes"],
        capture_output=True, text=True, timeout=30,
    )
    return result.stdout


def _run_squeue() -> str:
    result = subprocess.run(
        ["squeue", "-o", "%i|%N|%L|%e|%b", "-t", "RUNNING", "--noheader"],
        capture_output=True, text=True, timeout=30,
    )
    return result.stdout


def _expand_nodelist(nodelist: str) -> list[str]:
    if "[" not in nodelist:
        return [nodelist]
    try:
        result = subprocess.run(
            ["scontrol", "show", "hostnames", nodelist],
            capture_output=True, text=True, timeout=5,
        )
        return [n.strip() for n in result.stdout.strip().splitlines() if n.strip()]
    except Exception:
        return [nodelist]


def _parse_squeue_gpu_count(tres_str: str) -> int:
    if not tres_str or tres_str == "N/A":
        return 0
    m = re.search(r"gres/gpu(?::[a-zA-Z0-9_-]+)?:(\d+)", tres_str)
    return int(m.group(1)) if m else 0


def _parse_squeue(raw: str) -> dict[str, list[dict]]:
    node_jobs: dict[str, list[dict]] = {}
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 5:
            continue
        job_id, nodelist, time_left, end_time, tres = parts[0], parts[1], parts[2], parts[3], parts[4]

        gpu_count = _parse_squeue_gpu_count(tres)
        if gpu_count == 0:
            continue

        if end_time == "N/A":
            continue

        expanded = _expand_nodelist(nodelist)
        job_info = {
            "job_id": job_id,
            "gpu_count": gpu_count,
            "end_time": end_time,
            "time_left": time_left,
        }
        for node in expanded:
            node_jobs.setdefault(node, []).append(job_info)
    return node_jobs


def _enrich_nodes_with_jobs(nodes: list[dict], node_jobs: dict[str, list[dict]]) -> None:
    for node in nodes:
        jobs = node_jobs.get(node["name"], [])
        if not jobs:
            node["next_gpu_free_at"] = None
            node["next_gpu_free_count"] = 0
            node["all_gpus_free_at"] = None
            node["running_jobs"] = []
            continue
        sorted_jobs = sorted(jobs, key=lambda j: j["end_time"])
        node["next_gpu_free_at"] = sorted_jobs[0]["end_time"]
        node["next_gpu_free_count"] = sorted_jobs[0]["gpu_count"]
        node["all_gpus_free_at"] = sorted_jobs[-1]["end_time"]
        node["running_jobs"] = [
            {"job_id": j["job_id"], "gpu_count": j["gpu_count"],
             "end_time": j["end_time"], "time_left": j["time_left"]}
            for j in sorted_jobs
        ]


def _parse_field(block: str, field: str) -> str:
    pattern = rf"{field}=(\S+)"
    m = re.search(pattern, block)
    return m.group(1) if m else ""


def _detect_gpu_type(features: str) -> str:
    tokens = features.lower().split(",")
    for gpu in GPU_PRIORITY:
        if gpu in tokens:
            return gpu
    return "unknown"


def _detect_cpu_type(features: str) -> str:
    tokens = set(features.lower().split(","))
    if "sapphire" in tokens:
        return "sapphire"
    if "epyc" in tokens:
        if "el9" in tokens:
            return "epyc-el9"
        return "epyc"
    if "cascadelake" in tokens:
        return "cascadelake"
    if "skylake" in tokens:
        return "skylake"
    if "broadwell" in tokens:
        return "broadwell"
    if "haswell" in tokens:
        return "haswell"
    if "ivybridge" in tokens:
        return "ivybridge"
    if "sandybridge" in tokens:
        return "sandybridge"
    return "unknown"


def _parse_gres_gpu_count(gres: str) -> int:
    if not gres or gres == "(null)":
        return 0
    # Match gpu:8, gpu:h100-40g:16, gpu:8(S:0-1), gpu:h100-40g:16(S:0-1)
    m = re.search(r"gpu(?::[a-zA-Z0-9_-]+)?:(\d+)", gres)
    return int(m.group(1)) if m else 0


def _parse_alloc_gpu(alloc_tres: str) -> int:
    if not alloc_tres:
        return 0
    m = re.search(r"gres/gpu=(\d+)", alloc_tres)
    return int(m.group(1)) if m else 0


def _classify_state(raw_state: str) -> str:
    parts = set(raw_state.upper().replace("+", " ").replace("*", "").split())
    if parts & DOWN_STATES:
        return "down"
    if parts & DRAIN_STATES:
        return "drain"
    if "MIXED" in parts:
        return "mixed"
    if "ALLOCATED" in parts:
        return "allocated"
    if "IDLE" in parts:
        return "idle"
    return "other"


def _parse_nodes(raw: str) -> list[dict]:
    blocks = re.split(r"\n\s*\n", raw.strip())
    nodes = []
    for block in blocks:
        if not block.strip():
            continue
        name = _parse_field(block, "NodeName")
        if not name:
            continue

        features = _parse_field(block, "ActiveFeatures") or _parse_field(block, "AvailableFeatures")
        gres = _parse_field(block, "Gres")
        partitions_raw = _parse_field(block, "Partitions")
        raw_state = _parse_field(block, "State")
        alloc_tres = _parse_field(block, "AllocTRES")
        cpu_tot = int(_parse_field(block, "CPUTot") or 0)
        cpu_alloc = int(_parse_field(block, "CPUAlloc") or 0)
        real_memory = int(_parse_field(block, "RealMemory") or 0)
        alloc_mem = int(_parse_field(block, "AllocMem") or 0)

        gpu_type = _detect_gpu_type(features)
        gpu_total = _parse_gres_gpu_count(gres)
        if gpu_total == 0:
            continue  # skip non-GPU nodes

        state = _classify_state(raw_state)
        gpu_alloc = _parse_alloc_gpu(alloc_tres)
        partitions = set(partitions_raw.split(",")) if partitions_raw else set()
        accessible = bool(partitions & ACCESSIBLE_PARTITIONS)

        if state in ("down", "drain"):
            gpu_down = gpu_total
            gpu_available = 0
            gpu_allocated = 0
        else:
            gpu_down = 0
            gpu_allocated = gpu_alloc
            gpu_available = gpu_total - gpu_alloc

        nodes.append({
            "name": name,
            "gpu_type": gpu_type,
            "gpu_total": gpu_total,
            "gpu_allocated": gpu_allocated,
            "gpu_available": gpu_available,
            "gpu_down": gpu_down,
            "state": state,
            "raw_state": raw_state,
            "partitions": sorted(partitions),
            "accessible": accessible,
            "cpu_total": cpu_tot,
            "cpu_alloc": cpu_alloc,
            "mem_total_mb": real_memory,
            "mem_alloc_mb": alloc_mem,
        })
    return nodes


def _gpu_type_sort_key(gpu_type: str) -> int:
    try:
        return GPU_PRIORITY.index(gpu_type)
    except ValueError:
        return len(GPU_PRIORITY)


def _build_summary(nodes: list[dict]) -> dict:
    gpu_groups: dict[str, dict] = {}
    for node in nodes:
        gt = node["gpu_type"]
        if gt not in gpu_groups:
            gpu_groups[gt] = {
                "gpu_type": gt,
                "total": 0, "allocated": 0, "available": 0, "down": 0,
                "nodes": [], "partitions": set(), "accessible": False,
            }
        g = gpu_groups[gt]
        g["total"] += node["gpu_total"]
        g["allocated"] += node["gpu_allocated"]
        g["available"] += node["gpu_available"]
        g["down"] += node["gpu_down"]
        g["nodes"].append(node)
        g["partitions"].update(node["partitions"])
        if node["accessible"]:
            g["accessible"] = True

    # Sort groups by performance tier
    sorted_groups = sorted(gpu_groups.values(), key=lambda g: _gpu_type_sort_key(g["gpu_type"]))
    for g in sorted_groups:
        g["partitions"] = sorted(g["partitions"])

    total = sum(g["total"] for g in sorted_groups)
    allocated = sum(g["allocated"] for g in sorted_groups)
    available = sum(g["available"] for g in sorted_groups)
    down = sum(g["down"] for g in sorted_groups)

    return {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "totals": {"total": total, "allocated": allocated, "available": available, "down": down},
        "gpu_types": sorted_groups,
    }


def get_gpu_status() -> dict:
    now = time.time()
    if _cache["data"] and (now - _cache["timestamp"]) < CACHE_TTL:
        return _cache["data"]

    raw = _run_scontrol()
    nodes = _parse_nodes(raw)

    try:
        squeue_raw = _run_squeue()
        node_jobs = _parse_squeue(squeue_raw)
        _enrich_nodes_with_jobs(nodes, node_jobs)
    except Exception:
        for node in nodes:
            node.setdefault("running_jobs", [])
            node.setdefault("next_gpu_free_at", None)
            node.setdefault("next_gpu_free_count", 0)
            node.setdefault("all_gpus_free_at", None)

    data = _build_summary(nodes)
    _cache["data"] = data
    _cache["timestamp"] = now
    return data


def _parse_cpu_nodes(raw: str) -> list[dict]:
    blocks = re.split(r"\n\s*\n", raw.strip())
    nodes = []
    for block in blocks:
        if not block.strip():
            continue
        name = _parse_field(block, "NodeName")
        if not name:
            continue

        features = _parse_field(block, "ActiveFeatures") or _parse_field(block, "AvailableFeatures")
        partitions_raw = _parse_field(block, "Partitions")
        raw_state = _parse_field(block, "State")
        cpu_tot = int(_parse_field(block, "CPUTot") or 0)
        cpu_alloc = int(_parse_field(block, "CPUAlloc") or 0)
        real_memory = int(_parse_field(block, "RealMemory") or 0)
        alloc_mem = int(_parse_field(block, "AllocMem") or 0)

        if cpu_tot == 0:
            continue

        cpu_type = _detect_cpu_type(features)
        state = _classify_state(raw_state)
        partitions = set(partitions_raw.split(",")) if partitions_raw else set()
        accessible = bool(partitions & ACCESSIBLE_PARTITIONS)

        if state in ("down", "drain"):
            cpu_down = cpu_tot
            cpu_available = 0
            cpu_allocated = 0
            mem_down = real_memory
            mem_available = 0
            mem_allocated = 0
        else:
            cpu_down = 0
            cpu_allocated = cpu_alloc
            cpu_available = cpu_tot - cpu_alloc
            mem_down = 0
            mem_allocated = alloc_mem
            mem_available = real_memory - alloc_mem

        nodes.append({
            "name": name,
            "cpu_type": cpu_type,
            "cpu_total": cpu_tot,
            "cpu_allocated": cpu_allocated,
            "cpu_available": cpu_available,
            "cpu_down": cpu_down,
            "mem_total_mb": real_memory,
            "mem_allocated_mb": mem_allocated,
            "mem_available_mb": mem_available,
            "mem_down_mb": mem_down,
            "state": state,
            "raw_state": raw_state,
            "partitions": sorted(partitions),
            "accessible": accessible,
        })
    return nodes


def _cpu_type_sort_key(cpu_type: str) -> int:
    try:
        return CPU_PRIORITY.index(cpu_type)
    except ValueError:
        return len(CPU_PRIORITY)


def _build_cpu_summary(nodes: list[dict]) -> dict:
    cpu_groups: dict[str, dict] = {}
    for node in nodes:
        ct = node["cpu_type"]
        if ct not in cpu_groups:
            cpu_groups[ct] = {
                "cpu_type": ct,
                "total": 0, "allocated": 0, "available": 0, "down": 0,
                "mem_total_mb": 0, "mem_allocated_mb": 0,
                "mem_available_mb": 0, "mem_down_mb": 0,
                "nodes": [], "partitions": set(), "accessible": False,
            }
        g = cpu_groups[ct]
        g["total"] += node["cpu_total"]
        g["allocated"] += node["cpu_allocated"]
        g["available"] += node["cpu_available"]
        g["down"] += node["cpu_down"]
        g["mem_total_mb"] += node["mem_total_mb"]
        g["mem_allocated_mb"] += node["mem_allocated_mb"]
        g["mem_available_mb"] += node["mem_available_mb"]
        g["mem_down_mb"] += node["mem_down_mb"]
        g["nodes"].append(node)
        g["partitions"].update(node["partitions"])
        if node["accessible"]:
            g["accessible"] = True

    sorted_groups = sorted(cpu_groups.values(), key=lambda g: _cpu_type_sort_key(g["cpu_type"]))
    for g in sorted_groups:
        g["partitions"] = sorted(g["partitions"])

    total = sum(g["total"] for g in sorted_groups)
    allocated = sum(g["allocated"] for g in sorted_groups)
    available = sum(g["available"] for g in sorted_groups)
    down = sum(g["down"] for g in sorted_groups)

    return {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "totals": {"total": total, "allocated": allocated, "available": available, "down": down},
        "cpu_types": sorted_groups,
    }


def get_cpu_status() -> dict:
    now = time.time()
    if _cpu_cache["data"] and (now - _cpu_cache["timestamp"]) < CACHE_TTL:
        return _cpu_cache["data"]

    raw = _run_scontrol()
    nodes = _parse_cpu_nodes(raw)
    data = _build_cpu_summary(nodes)
    _cpu_cache["data"] = data
    _cpu_cache["timestamp"] = now
    return data


if __name__ == "__main__":
    print(json.dumps(get_gpu_status(), indent=2))
