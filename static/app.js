let refreshInterval = 30;
let countdown = refreshInterval;
let timer = null;
let currentData = null;
let currentCpuData = null;
let currentJobsData = null;
let activeTab = "gpu";

// --- Tab Switching ---

function switchTab(tab) {
  activeTab = tab;
  document.getElementById("gpu-tab").classList.toggle("hidden", tab !== "gpu");
  document.getElementById("cpu-tab").classList.toggle("hidden", tab !== "cpu");
  document.getElementById("jobs-tab").classList.toggle("hidden", tab !== "jobs");
  document.getElementById("tab-gpu").classList.toggle("active", tab === "gpu");
  document.getElementById("tab-cpu").classList.toggle("active", tab === "cpu");
  document.getElementById("tab-jobs").classList.toggle("active", tab === "jobs");
  document.getElementById("node-filters").classList.toggle("hidden", tab === "jobs");

  if (tab === "gpu" && currentData) {
    render(currentData);
  } else if (tab === "cpu") {
    fetchCpuData();
  } else if (tab === "jobs") {
    fetchJobsData();
  }
}

// --- Fetch & Refresh ---

async function fetchData() {
  if (activeTab === "gpu") {
    await fetchGpuData();
  } else if (activeTab === "cpu") {
    await fetchCpuData();
  } else if (activeTab === "jobs") {
    await fetchJobsData();
  }
}

async function fetchGpuData() {
  try {
    const res = await fetch("/api/gpu-status");
    currentData = await res.json();
    render(currentData);
  } catch (e) {
    document.getElementById("last-updated").textContent = "Error fetching data";
  }
}

async function fetchCpuData() {
  try {
    const res = await fetch("/api/cpu-status");
    currentCpuData = await res.json();
    renderCpu(currentCpuData);
  } catch (e) {
    document.getElementById("last-updated").textContent = "Error fetching data";
  }
}

async function fetchJobsData() {
  try {
    const res = await fetch("/api/user-jobs");
    currentJobsData = await res.json();
    renderJobs(currentJobsData);
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

// --- GPU Rendering ---

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
        ${g.partitions.map(p => partitionBadge(p)).join("")}
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

    const headerRow = document.createElement("tr");
    headerRow.className = "gpu-section-header";
    headerRow.id = "section-" + g.gpu_type;
    headerRow.innerHTML = `<td colspan="9">${escHtml(g.gpu_type.toUpperCase())} — ${g.available} / ${g.total} available</td>`;
    tbody.appendChild(headerRow);

    for (const n of filtered) {
      const tr = document.createElement("tr");
      if (!n.accessible) tr.className = "not-accessible";

      const isDown = n.state === "down" || n.state === "drain";
      const cpuAvail = isDown ? 0 : n.cpu_total - n.cpu_alloc;
      const memTotalGB = (n.mem_total_mb / 1024).toFixed(0);
      const memAvailGB = isDown ? "0" : ((n.mem_total_mb - n.mem_alloc_mb) / 1024).toFixed(0);

      tr.innerHTML = `
        <td class="px-4 py-2 font-mono text-xs">${escHtml(n.name)}</td>
        <td class="px-4 py-2 uppercase font-semibold text-xs">${escHtml(n.gpu_type)}</td>
        <td class="px-4 py-2 tabular-nums">${n.gpu_available}/${n.gpu_total}</td>
        <td class="px-4 py-2">${buildMiniBar(n.gpu_available, n.gpu_allocated, n.gpu_down, n.gpu_total)}</td>
        <td class="px-4 py-2">${n.partitions.map(p => partitionBadge(p)).join(" ")}</td>
        <td class="px-4 py-2 tabular-nums">${cpuAvail}/${n.cpu_total}</td>
        <td class="px-4 py-2 tabular-nums">${memAvailGB}/${memTotalGB} GB</td>
        <td class="px-4 py-2 text-xs">${buildTimelineCell(n)}</td>
        <td class="px-4 py-2 text-xs"><span class="font-semibold state-${n.state}">${escHtml(n.raw_state)}</span></td>
      `;
      tbody.appendChild(tr);
    }
  }
}

// --- CPU Rendering ---

function renderCpu(data) {
  document.getElementById("last-updated").textContent = "Updated: " + data.timestamp;
  renderCpuSummaryStrip(data.totals);
  renderCpuTypeCards(data.cpu_types);
  renderCpuNodeTable(data.cpu_types);
}

function renderCpuSummaryStrip(totals) {
  document.getElementById("cpu-stat-total").textContent = totals.total;
  document.getElementById("cpu-stat-allocated").textContent = totals.allocated;
  document.getElementById("cpu-stat-available").textContent = totals.available;
  document.getElementById("cpu-stat-down").textContent = totals.down;
}

function renderCpuTypeCards(cpuTypes) {
  const container = document.getElementById("cpu-cards");
  container.innerHTML = "";

  for (const g of cpuTypes) {
    const card = document.createElement("div");
    card.className = "gpu-card";
    card.onclick = () => {
      const target = document.getElementById("cpu-section-" + g.cpu_type);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const pct = g.total > 0 ? ((g.available / g.total) * 100).toFixed(0) : 0;

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="font-bold text-base uppercase">${escHtml(g.cpu_type)}</span>
        ${g.accessible ? '<span class="text-green-500 text-xs font-semibold">ACCESSIBLE</span>' : ""}
      </div>
      ${buildBar(g.available, g.allocated, g.down, g.total)}
      <div class="flex items-center justify-between mt-2 text-sm">
        <span class="font-semibold text-green-600 dark:text-green-400">${g.available} / ${g.total} available</span>
        <span class="text-gray-500">${pct}%</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-1">
        ${g.partitions.map(p => partitionBadge(p)).join("")}
      </div>
    `;
    container.appendChild(card);
  }
}

function renderCpuNodeTable(cpuTypes) {
  const tbody = document.getElementById("cpu-node-table-body");
  tbody.innerHTML = "";

  const search = document.getElementById("search").value.toLowerCase();
  const accessibleOnly = document.getElementById("filter-accessible").checked;
  const hideDown = document.getElementById("filter-hide-down").checked;

  for (const g of cpuTypes) {
    const filtered = g.nodes.filter(n => {
      if (search && !n.name.toLowerCase().includes(search)) return false;
      if (accessibleOnly && !n.accessible) return false;
      if (hideDown && (n.state === "down" || n.state === "drain")) return false;
      return true;
    });

    if (filtered.length === 0) continue;

    const headerRow = document.createElement("tr");
    headerRow.className = "gpu-section-header";
    headerRow.id = "cpu-section-" + g.cpu_type;
    headerRow.innerHTML = `<td colspan="8">${escHtml(g.cpu_type.toUpperCase())} — ${g.available} / ${g.total} cores available</td>`;
    tbody.appendChild(headerRow);

    for (const n of filtered) {
      const tr = document.createElement("tr");
      if (!n.accessible) tr.className = "not-accessible";

      const memTotalGB = (n.mem_total_mb / 1024).toFixed(0);
      const memAllocGB = (n.mem_allocated_mb / 1024).toFixed(0);
      const memAvailGB = (n.mem_available_mb / 1024).toFixed(0);
      const memDownGB = (n.mem_down_mb / 1024).toFixed(0);

      tr.innerHTML = `
        <td class="px-4 py-2 font-mono text-xs">${escHtml(n.name)}</td>
        <td class="px-4 py-2 uppercase font-semibold text-xs">${escHtml(n.cpu_type)}</td>
        <td class="px-4 py-2 tabular-nums">${n.cpu_available}/${n.cpu_total}</td>
        <td class="px-4 py-2">${buildMiniBar(n.cpu_available, n.cpu_allocated, n.cpu_down, n.cpu_total)}</td>
        <td class="px-4 py-2">${n.partitions.map(p => partitionBadge(p)).join(" ")}</td>
        <td class="px-4 py-2 tabular-nums">${memAvailGB}/${memTotalGB} GB</td>
        <td class="px-4 py-2">${buildMiniBar(parseInt(memAvailGB), parseInt(memAllocGB), parseInt(memDownGB), parseInt(memTotalGB))}</td>
        <td class="px-4 py-2 text-xs"><span class="font-semibold state-${n.state}">${escHtml(n.raw_state)}</span></td>
      `;
      tbody.appendChild(tr);
    }
  }
}

// --- My Jobs Rendering ---

function renderJobs(data) {
  document.getElementById("last-updated").textContent = "Updated: " + data.timestamp;
  document.getElementById("jobs-user").textContent = data.user || "(unknown)";

  const errBox = document.getElementById("jobs-error");
  if (data.error) {
    errBox.textContent = "Error: " + data.error;
    errBox.classList.remove("hidden");
  } else {
    errBox.classList.add("hidden");
  }

  const c = data.counts || {total: 0, running: 0, scheduled: 0, pending: 0};
  document.getElementById("jobs-stat-total").textContent = c.total;
  document.getElementById("jobs-stat-running").textContent = c.running;
  document.getElementById("jobs-stat-scheduled").textContent = c.scheduled;
  document.getElementById("jobs-stat-pending").textContent = c.pending;

  renderJobsTable(data);
}

function renderJobsTable(data) {
  const tbody = document.getElementById("jobs-table-body");
  tbody.innerHTML = "";

  const groups = [
    { key: "running",   label: "Running",   rows: data.running   || [] },
    { key: "scheduled", label: "Scheduled", rows: data.scheduled || [] },
    { key: "pending",   label: "Pending",   rows: data.pending   || [] },
    { key: "other",     label: "Other",     rows: data.other     || [] },
  ];

  let rendered = 0;
  for (const { key, label, rows } of groups) {
    if (rows.length === 0) continue;
    const hdr = document.createElement("tr");
    hdr.className = "gpu-section-header";
    hdr.innerHTML = `<td colspan="9">${escHtml(label.toUpperCase())} — ${rows.length} job${rows.length > 1 ? "s" : ""}</td>`;
    tbody.appendChild(hdr);
    for (const j of rows) {
      tbody.appendChild(buildJobRow(j, key));
      rendered++;
    }
  }

  if (rendered === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" class="px-4 py-6 text-center text-gray-500">No jobs found for current user.</td>`;
    tbody.appendChild(tr);
  }
}

function buildJobRow(j, groupKey) {
  const tr = document.createElement("tr");

  const gpuCell = j.gpu_count > 0
    ? `<span class="tabular-nums">${j.gpu_count}</span>`
    : `<span class="text-gray-400">—</span>`;

  const memCell = j.min_memory && j.min_memory !== "N/A"
    ? `<span class="tabular-nums">${escHtml(j.min_memory)}</span>`
    : `<span class="text-gray-400">—</span>`;

  const constraintsCell = (j.features_list && j.features_list.length > 0)
    ? j.features_list.map(f => `<span class="badge badge-feature">${escHtml(f)}</span>`).join(" ")
    : `<span class="text-gray-400">—</span>`;

  let nodeWhen = "";
  let status = "";

  if (groupKey === "running") {
    const node = (j.nodelist && j.nodelist !== "(null)") ? j.nodelist : "(assigning)";
    nodeWhen =
      `<div class="font-mono text-xs">${escHtml(node)}</div>` +
      `<div class="text-xs text-gray-500">${escHtml(j.time_left)} left</div>`;
    status = `<span class="badge badge-running">RUNNING</span>`;
  } else if (groupKey === "scheduled") {
    const start = new Date(j.start_time);
    const rel = isNaN(start) ? "?" : formatRelativeTime(start - new Date());
    nodeWhen =
      `<div class="text-xs">starts in <span class="font-mono">${escHtml(rel)}</span></div>` +
      `<div class="text-xs text-gray-500 font-mono" title="${escHtml(j.start_time)}">${escHtml(j.start_time)}</div>`;
    status = `<span class="badge badge-scheduled">SCHEDULED</span>`;
  } else if (groupKey === "pending") {
    const reqTime = j.time_limit && j.time_limit !== "N/A" ? j.time_limit : "-";
    nodeWhen =
      `<div class="text-xs">requested <span class="font-mono">${escHtml(reqTime)}</span></div>` +
      `<div class="text-xs text-gray-500">${escHtml(j.reason || "-")}</div>`;
    const rank = j.rank != null ? j.rank : "?";
    status =
      `<span class="badge badge-rank" title="priority ${escHtml(String(j.priority))}">#${escHtml(String(rank))}</span>` +
      `<div class="text-xs text-gray-500 mt-1">${escHtml(j.reason || "")}</div>`;
  } else {
    nodeWhen = `<span class="text-gray-400">—</span>`;
    status = `<span class="badge badge-other">${escHtml(j.state)}</span>`;
  }

  tr.innerHTML =
    `<td class="px-4 py-2">` +
      `<div class="font-mono text-xs">${escHtml(j.job_id)}</div>` +
      `<div class="text-xs text-gray-500 truncate max-w-xs" title="${escHtml(j.name)}">${escHtml(j.name)}</div>` +
    `</td>` +
    `<td class="px-4 py-2">${partitionBadge(j.partition)}</td>` +
    `<td class="px-4 py-2 tabular-nums">${j.cpus}</td>` +
    `<td class="px-4 py-2">${gpuCell}</td>` +
    `<td class="px-4 py-2">${memCell}</td>` +
    `<td class="px-4 py-2 tabular-nums">${j.num_nodes}</td>` +
    `<td class="px-4 py-2">${constraintsCell}</td>` +
    `<td class="px-4 py-2">${nodeWhen}</td>` +
    `<td class="px-4 py-2">${status}</td>`;

  return tr;
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

// Stable per-name hue on a 12-bucket color wheel — same partition always gets same hue.
function partitionHue(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  }
  const buckets = 12;
  return ((h >>> 0) % buckets) * (360 / buckets);
}

function accessibleSet() {
  const src =
    (currentData && currentData.accessible_partitions) ||
    (currentCpuData && currentCpuData.accessible_partitions) ||
    (currentJobsData && currentJobsData.accessible_partitions) ||
    [];
  return new Set(src);
}

function partitionBadge(partition) {
  const esc = escHtml(partition);
  const set = accessibleSet();
  // If the server couldn't detect any accessible partitions, treat every
  // partition as accessible (same graceful-degradation rule as the node flag).
  const accessible = set.size === 0 || set.has(partition);
  if (!accessible) {
    return `<span class="badge badge-partition-inaccessible">${esc}</span>`;
  }
  const hue = partitionHue(partition);
  return `<span class="badge badge-partition" style="--hue:${hue}">${esc}</span>`;
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

function reRenderActiveTable() {
  if (activeTab === "gpu" && currentData) {
    renderNodeTable(currentData.gpu_types);
  } else if (activeTab === "cpu" && currentCpuData) {
    renderCpuNodeTable(currentCpuData.cpu_types);
  }
}

document.getElementById("search").addEventListener("input", reRenderActiveTable);
document.getElementById("filter-accessible").addEventListener("change", reRenderActiveTable);
document.getElementById("filter-hide-down").addEventListener("change", reRenderActiveTable);

// --- Init ---

fetchGpuData();
startTimer();
