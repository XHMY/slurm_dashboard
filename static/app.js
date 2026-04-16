let refreshInterval = 30;
let countdown = refreshInterval;
let timer = null;
let currentData = null;

// --- Fetch & Refresh ---

async function fetchData() {
  try {
    const res = await fetch("/api/gpu-status");
    currentData = await res.json();
    render(currentData);
  } catch (e) {
    document.getElementById("last-updated").textContent = "Error fetching data";
  }
}

function manualRefresh() {
  countdown = refreshInterval;
  fetchData();
}

function startTimer() {
  timer = setInterval(() => {
    countdown--;
    document.getElementById("countdown").textContent = countdown + "s";
    if (countdown <= 0) {
      countdown = refreshInterval;
      fetchData();
    }
  }, 1000);
}

// --- Rendering ---

function render(data) {
  document.getElementById("last-updated").textContent = "Updated: " + data.timestamp;
  renderSummaryStrip(data.totals);
  renderGpuTypeCards(data.gpu_types);
  renderNodeTable(data.gpu_types);
}

function renderSummaryStrip(totals) {
  document.getElementById("stat-total").textContent = totals.total;
  document.getElementById("stat-allocated").textContent = totals.allocated;
  document.getElementById("stat-available").textContent = totals.available;
  document.getElementById("stat-down").textContent = totals.down;
}

function renderGpuTypeCards(gpuTypes) {
  const container = document.getElementById("gpu-cards");
  container.innerHTML = "";

  for (const g of gpuTypes) {
    const card = document.createElement("div");
    card.className = "gpu-card";
    card.onclick = () => {
      const target = document.getElementById("section-" + g.gpu_type);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const pct = g.total > 0 ? ((g.available / g.total) * 100).toFixed(0) : 0;

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="font-bold text-base uppercase">${escHtml(g.gpu_type)}</span>
        ${g.accessible ? '<span class="text-green-500 text-xs font-semibold">ACCESSIBLE</span>' : ""}
      </div>
      ${buildBar(g.available, g.allocated, g.down, g.total)}
      <div class="flex items-center justify-between mt-2 text-sm">
        <span class="font-semibold text-green-600 dark:text-green-400">${g.available} / ${g.total} available</span>
        <span class="text-gray-500">${pct}%</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-1">
        ${g.partitions.map(p => `<span class="badge ${badgeClass(p)}">${escHtml(p)}</span>`).join("")}
      </div>
    `;
    container.appendChild(card);
  }
}

function renderNodeTable(gpuTypes) {
  const tbody = document.getElementById("node-table-body");
  tbody.innerHTML = "";

  const search = document.getElementById("search").value.toLowerCase();
  const accessibleOnly = document.getElementById("filter-accessible").checked;
  const hideDown = document.getElementById("filter-hide-down").checked;

  for (const g of gpuTypes) {
    const filtered = g.nodes.filter(n => {
      if (search && !n.name.toLowerCase().includes(search)) return false;
      if (accessibleOnly && !n.accessible) return false;
      if (hideDown && (n.state === "down" || n.state === "drain")) return false;
      return true;
    });

    if (filtered.length === 0) continue;

    // Section header
    const headerRow = document.createElement("tr");
    headerRow.className = "gpu-section-header";
    headerRow.id = "section-" + g.gpu_type;
    headerRow.innerHTML = `<td colspan="9">${escHtml(g.gpu_type.toUpperCase())} — ${g.available} / ${g.total} available</td>`;
    tbody.appendChild(headerRow);

    for (const n of filtered) {
      const tr = document.createElement("tr");
      if (!n.accessible) tr.className = "not-accessible";

      const memTotalGB = (n.mem_total_mb / 1024).toFixed(0);
      const memAllocGB = (n.mem_alloc_mb / 1024).toFixed(0);

      tr.innerHTML = `
        <td class="px-4 py-2 font-mono text-xs">${escHtml(n.name)}</td>
        <td class="px-4 py-2 uppercase font-semibold text-xs">${escHtml(n.gpu_type)}</td>
        <td class="px-4 py-2 tabular-nums">${n.gpu_available}/${n.gpu_total}</td>
        <td class="px-4 py-2">${buildMiniBar(n.gpu_available, n.gpu_allocated, n.gpu_down, n.gpu_total)}</td>
        <td class="px-4 py-2">${n.partitions.map(p => `<span class="badge ${badgeClass(p)}">${escHtml(p)}</span>`).join(" ")}</td>
        <td class="px-4 py-2 tabular-nums">${n.cpu_alloc}/${n.cpu_total}</td>
        <td class="px-4 py-2 tabular-nums">${memAllocGB}/${memTotalGB} GB</td>
        <td class="px-4 py-2 text-xs">${buildTimelineCell(n)}</td>
        <td class="px-4 py-2 text-xs"><span class="font-semibold state-${n.state}">${escHtml(n.raw_state)}</span></td>
      `;
      tbody.appendChild(tr);
    }
  }
}

// --- Helpers ---

function buildBar(avail, alloc, down, total) {
  if (total === 0) return '<div class="avail-bar"></div>';
  const pA = (avail / total * 100).toFixed(1);
  const pB = (alloc / total * 100).toFixed(1);
  const pD = (down / total * 100).toFixed(1);
  return `<div class="avail-bar">
    <div class="seg-available" style="width:${pA}%"></div>
    <div class="seg-allocated" style="width:${pB}%"></div>
    <div class="seg-down" style="width:${pD}%"></div>
  </div>`;
}

function buildMiniBar(avail, alloc, down, total) {
  if (total === 0) return '<div class="avail-bar-mini"></div>';
  const pA = (avail / total * 100).toFixed(1);
  const pB = (alloc / total * 100).toFixed(1);
  const pD = (down / total * 100).toFixed(1);
  return `<div class="avail-bar-mini">
    <div class="seg-available" style="width:${pA}%"></div>
    <div class="seg-allocated" style="width:${pB}%"></div>
    <div class="seg-down" style="width:${pD}%"></div>
  </div>`;
}

function badgeClass(partition) {
  if (partition === "preempt") return "badge-preempt";
  if (partition === "dgxh") return "badge-dgxh";
  if (partition === "hw-grp") return "badge-hw-grp";
  return "badge-other";
}

function buildTimelineCell(node) {
  if (!node.running_jobs || node.running_jobs.length === 0) {
    if (node.state === "idle") return '<span class="text-green-500 dark:text-green-400">All free</span>';
    if (node.state === "down" || node.state === "drain") return '<span class="text-gray-400">--</span>';
    return "";
  }

  const now = new Date();
  let lines = [];

  if (node.next_gpu_free_at) {
    const nextFree = new Date(node.next_gpu_free_at);
    const relTime = formatRelativeTime(nextFree - now);
    lines.push(
      `<div class="timeline-next" title="${escHtml(node.next_gpu_free_at)}">` +
      `<span class="text-green-600 dark:text-green-400 font-semibold">+${node.next_gpu_free_count} GPU</span> ` +
      `in <span class="font-mono">${relTime}</span></div>`
    );
  }

  if (node.all_gpus_free_at && node.all_gpus_free_at !== node.next_gpu_free_at) {
    const allFree = new Date(node.all_gpus_free_at);
    const relTime = formatRelativeTime(allFree - now);
    lines.push(
      `<div class="timeline-all" title="${escHtml(node.all_gpus_free_at)}">` +
      `All free in <span class="font-mono">${relTime}</span></div>`
    );
  }

  if (node.running_jobs.length > 0) {
    const jobSummary = node.running_jobs.map(j =>
      `Job ${j.job_id}: ${j.gpu_count} GPU, ${j.time_left} left (ends ${j.end_time})`
    ).join("\n");
    lines.push(
      `<div class="timeline-jobs cursor-help" title="${escHtml(jobSummary)}">` +
      `${node.running_jobs.length} job${node.running_jobs.length > 1 ? "s" : ""}</div>`
    );
  }

  return lines.join("");
}

function formatRelativeTime(ms) {
  if (ms <= 0) return "now";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// --- Filter listeners ---

document.getElementById("search").addEventListener("input", () => {
  if (currentData) renderNodeTable(currentData.gpu_types);
});
document.getElementById("filter-accessible").addEventListener("change", () => {
  if (currentData) renderNodeTable(currentData.gpu_types);
});
document.getElementById("filter-hide-down").addEventListener("change", () => {
  if (currentData) renderNodeTable(currentData.gpu_types);
});

// --- Init ---

fetchData();
startTimer();
