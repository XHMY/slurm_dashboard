let refreshInterval = 30;
let countdown = refreshInterval;
let timer = null;
let currentData = null;
let currentCpuData = null;
let currentJobsData = null;
let currentStorageData = null;
let storageLoaded = false;  // lazy-load guard: storage fetches only on first view / manual refresh
let activeTab = "gpu";
let expandedNode = null;
const STORAGE_KEYS = {
  activeTab: "slurmDashboard.activeTab",
  accessibleOnly: "slurmDashboard.accessibleOnly",
  hideDown: "slurmDashboard.hideDown",
};

// --- Tab Switching ---

function switchTab(tab, options = {}) {
  const { persist = true, fetchIfNeeded = true } = options;
  const previousTab = activeTab;
  activeTab = tab;
  if (persist) saveStoredValue(STORAGE_KEYS.activeTab, tab);
  if (previousTab !== tab) expandedNode = null;
  document.getElementById("gpu-tab").classList.toggle("hidden", tab !== "gpu");
  document.getElementById("cpu-tab").classList.toggle("hidden", tab !== "cpu");
  document.getElementById("jobs-tab").classList.toggle("hidden", tab !== "jobs");
  document.getElementById("storage-tab").classList.toggle("hidden", tab !== "storage");
  document.getElementById("tab-gpu").classList.toggle("active", tab === "gpu");
  document.getElementById("tab-cpu").classList.toggle("active", tab === "cpu");
  document.getElementById("tab-jobs").classList.toggle("active", tab === "jobs");
  document.getElementById("tab-storage").classList.toggle("active", tab === "storage");
  document.getElementById("node-filters").classList.toggle("hidden", tab === "jobs" || tab === "storage");

  if (!fetchIfNeeded) return;

  if (tab === "gpu") {
    if (currentData) render(currentData);
    fetchGpuData();
  } else if (tab === "cpu") {
    if (currentCpuData) renderCpu(currentCpuData);
    fetchCpuData();
  } else if (tab === "jobs") {
    if (currentJobsData) renderJobs(currentJobsData);
    fetchJobsData();
  } else if (tab === "storage") {
    // Lazy load: fetch only the first time storage is opened. Re-render cached
    // data on subsequent visits; the Refresh button re-fetches explicitly.
    if (currentStorageData) renderStorage(currentStorageData);
    if (!storageLoaded) fetchStorageData();
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

// Storage is intentionally excluded from fetchData()/startTimer() — it is lazy
// and never auto-refreshes. It is fetched only on first tab open and via its
// own Refresh button (force=true bypasses the server's 30s cache).
async function fetchStorageData(force = false) {
  const loading = document.getElementById("storage-loading");
  loading.textContent = "Loading storage usage… (unreachable mounts may take a few seconds)";
  loading.classList.remove("hidden");
  try {
    const res = await fetch("/api/storage-status" + (force ? "?force=true" : ""));
    currentStorageData = await res.json();
    storageLoaded = true;
    renderStorage(currentStorageData);
  } catch (e) {
    loading.textContent = "Error fetching storage data";
    return;
  }
  loading.classList.add("hidden");
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
  const gpuTypes = filterGpuTypes(data.gpu_types);
  document.getElementById("last-updated").textContent = "Updated: " + data.timestamp;
  renderSummaryStrip(sumGroupTotals(gpuTypes));
  renderGpuTypeCards(gpuTypes);
  renderNodeTable(gpuTypes);
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

  for (const g of gpuTypes) {
    const headerRow = document.createElement("tr");
    headerRow.className = "gpu-section-header";
    headerRow.id = "section-" + g.gpu_type;
    headerRow.innerHTML = `<td colspan="9">${escHtml(g.gpu_type.toUpperCase())} — ${g.available} / ${g.total} available</td>`;
    tbody.appendChild(headerRow);

    for (const n of g.nodes) {
      const tr = document.createElement("tr");
      tr.className = "node-row";
      tr.dataset.nodeName = n.name;
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", "Show jobs on " + n.name);
      if (!n.accessible) tr.classList.add("not-accessible");
      tr.addEventListener("click", () => toggleNodeDetails(n, "gpu"));
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleNodeDetails(n, "gpu");
        }
      });
      if (isExpandedNode(n.name, "gpu")) {
        tr.classList.add("selected");
        tr.setAttribute("aria-expanded", "true");
      } else {
        tr.setAttribute("aria-expanded", "false");
      }

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
      if (isExpandedNode(n.name, "gpu")) {
        tbody.appendChild(buildNodeDetailsRow(n, 9));
      }
    }
  }
}

// --- CPU Rendering ---

function renderCpu(data) {
  const cpuTypes = filterCpuTypes(data.cpu_types);
  document.getElementById("last-updated").textContent = "Updated: " + data.timestamp;
  renderCpuSummaryStrip(sumGroupTotals(cpuTypes));
  renderCpuTypeCards(cpuTypes);
  renderCpuNodeTable(cpuTypes);
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

  for (const g of cpuTypes) {
    const headerRow = document.createElement("tr");
    headerRow.className = "gpu-section-header";
    headerRow.id = "cpu-section-" + g.cpu_type;
    headerRow.innerHTML = `<td colspan="8">${escHtml(g.cpu_type.toUpperCase())} — ${g.available} / ${g.total} cores available</td>`;
    tbody.appendChild(headerRow);

    for (const n of g.nodes) {
      const tr = document.createElement("tr");
      tr.className = "node-row";
      tr.dataset.nodeName = n.name;
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", "Show jobs on " + n.name);
      if (!n.accessible) tr.classList.add("not-accessible");
      tr.addEventListener("click", () => toggleNodeDetails(n, "cpu"));
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleNodeDetails(n, "cpu");
        }
      });
      if (isExpandedNode(n.name, "cpu")) {
        tr.classList.add("selected");
        tr.setAttribute("aria-expanded", "true");
      } else {
        tr.setAttribute("aria-expanded", "false");
      }

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
      if (isExpandedNode(n.name, "cpu")) {
        tbody.appendChild(buildNodeDetailsRow(n, 8));
      }
    }
  }
}

// --- Node Details Dropdown ---

function toggleNodeDetails(node, view) {
  if (isExpandedNode(node.name, view)) {
    expandedNode = null;
  } else {
    expandedNode = { name: node.name, view };
  }
  reRenderActiveTable();
}

function isExpandedNode(name, view) {
  return expandedNode && expandedNode.view === view && expandedNode.name === name;
}

function buildNodeDetailsRow(node, colspan) {
  const tr = document.createElement("tr");
  tr.className = "node-details-row";

  tr.innerHTML = `
    <td colspan="${colspan}" class="node-details-cell">
      <div class="node-details">
        <div class="node-details-title">Current Jobs (${(node.current_jobs || []).length})</div>
        ${buildCurrentJobList(node.current_jobs || [])}
      </div>
    </td>
  `;
  return tr;
}

function buildCurrentJobList(jobs) {
  if (!jobs || jobs.length === 0) {
    return `<div class="node-empty">No current jobs on this node.</div>`;
  }

  return jobs.map(job => {
    const gpuCell = job.gpu_count > 0 ? String(job.gpu_count) : "--";
    const endTime = job.end_time && job.end_time !== "N/A" ? job.end_time : "N/A";
    return `
      <div class="node-job">
        <span class="node-job-id">${escHtml(job.job_id)}</span>
        <span class="node-job-name" title="${escHtml(job.name)}">${escHtml(job.name)}</span>
        <span title="Partition">${escHtml(job.partition)}</span>
        <span title="CPU">CPU ${escHtml(String(job.cpus))}</span>
        <span title="GPU">GPU ${escHtml(gpuCell)}</span>
        <span title="Memory">Mem ${escHtml(job.min_memory || "N/A")}</span>
        <span title="Remaining time">Left ${escHtml(job.time_left || "N/A")}</span>
        <span>${escHtml(job.user)}</span>
        <span class="badge badge-running">${escHtml(job.state)}</span>
        <span>${escHtml(job.time_used || "N/A")} used</span>
        <span title="${escHtml(endTime)}">${escHtml(endTime)}</span>
      </div>
    `;
  }).join("");
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

// --- Storage Rendering ---

function renderStorage(data) {
  // Note: storage does NOT write #last-updated — that clock belongs to the
  // auto-refreshing tabs. It shows its own timestamp inline instead.
  const updated = document.getElementById("storage-updated");
  if (updated) updated.textContent = data.timestamp ? "(as of " + data.timestamp + ")" : "";

  const s = data.summary || {};
  document.getElementById("storage-stat-mounts").textContent = s.mount_count != null ? s.mount_count : "-";
  document.getElementById("storage-stat-free").textContent = humanBytes(s.avail_bytes);
  document.getElementById("storage-stat-mine").textContent = humanBytes(s.user_bytes);
  document.getElementById("storage-stat-unavailable").textContent = s.unavailable_count != null ? s.unavailable_count : "-";

  const tbody = document.getElementById("storage-table-body");
  tbody.innerHTML = "";

  // Display order: accessible mounts first, sorted by Free desc, then by the
  // space I use desc; unavailable/unreadable mounts sink to the bottom.
  const mounts = (data.mounts || []).slice().sort((a, b) => {
    if (a.accessible !== b.accessible) return a.accessible ? -1 : 1;
    const free = (b.avail_bytes || 0) - (a.avail_bytes || 0);
    if (free !== 0) return free;
    return (b.user_bytes || 0) - (a.user_bytes || 0);
  });
  if (mounts.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="px-4 py-6 text-center text-gray-500">No storage mounts found.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const m of mounts) {
    const tr = document.createElement("tr");

    if (!m.accessible) {
      const nameCell =
        `<div class="font-mono text-xs">${escHtml(m.key)}</div>` +
        `<div class="text-xs text-gray-500 truncate max-w-xs" title="${escHtml(m.source || "")}">${escHtml(m.source || "")}</div>`;
      tr.classList.add("not-accessible");
      const reason = m.error === "timeout" ? "timeout" : "unavailable";
      tr.innerHTML =
        `<td class="px-4 py-2">${nameCell}</td>` +
        `<td class="px-4 py-2"><span class="badge badge-storage-unavailable">${escHtml(reason)}</span></td>` +
        `<td class="px-4 py-2 text-right text-gray-400">—</td>` +
        `<td class="px-4 py-2 text-right text-gray-400">—</td>` +
        `<td class="px-4 py-2 text-right text-gray-400">—</td>` +
        `<td class="px-4 py-2 text-right text-gray-400">—</td>`;
      tbody.appendChild(tr);
      continue;
    }

    // Folders I own here, biggest first, skipping any that are 0 B.
    const folders = (m.user_folders || []).filter(f => f.bytes > 0);
    const expandable = folders.length > 0;
    const caret = expandable
      ? `<span class="storage-caret" aria-hidden="true">▶</span>`
      : `<span class="storage-caret-spacer" aria-hidden="true"></span>`;
    const nameCell =
      `<div class="font-mono text-xs">${caret}${escHtml(m.key)}</div>` +
      `<div class="text-xs text-gray-500 truncate max-w-xs" title="${escHtml(m.source || "")}">${escHtml(m.source || "")}</div>`;

    tr.innerHTML =
      `<td class="px-4 py-2">${nameCell}</td>` +
      `<td class="px-4 py-2">${buildStorageBar(m)}</td>` +
      `<td class="px-4 py-2 text-right tabular-nums text-blue-600 dark:text-blue-400">${humanBytes(m.user_bytes)}</td>` +
      `<td class="px-4 py-2 text-right tabular-nums">${humanBytes(m.others_bytes)}</td>` +
      `<td class="px-4 py-2 text-right tabular-nums text-green-600 dark:text-green-400">${humanBytes(m.avail_bytes)}</td>` +
      `<td class="px-4 py-2 text-right tabular-nums">${humanBytes(m.total_bytes)}</td>`;
    tbody.appendChild(tr);

    if (expandable) {
      tr.classList.add("storage-row");
      const detail = document.createElement("tr");
      detail.className = "storage-detail";
      detail.style.display = "none";
      detail.innerHTML = `<td colspan="6" class="storage-detail-cell">${buildFolderBreakdown(folders, m)}</td>`;
      tbody.appendChild(detail);
      const caretEl = tr.querySelector(".storage-caret");
      tr.addEventListener("click", () => {
        const open = detail.style.display !== "none";
        detail.style.display = open ? "none" : "";
        if (caretEl) caretEl.textContent = open ? "▶" : "▼";
      });
    }
  }
}

// Per-mount breakdown of the top-level folders the current user owns, sorted
// biggest first. Shown when a Storage row is clicked.
function buildFolderBreakdown(folders, m) {
  const maxB = folders.reduce((mx, f) => Math.max(mx, f.bytes), 0) || 1;
  const rows = folders.map(f => {
    const pct = (f.bytes / maxB * 100).toFixed(1);
    const full = (m.path ? m.path + "/" : "") + f.name;
    return `<div class="storage-folder-row">
      <span class="storage-folder-name font-mono" title="${escHtml(full)}">${escHtml(f.name)}</span>
      <span class="storage-folder-track"><span class="storage-folder-fill" style="width:${pct}%"></span></span>
      <span class="storage-folder-size tabular-nums">${humanBytes(f.bytes)}</span>
    </div>`;
  }).join("");
  const n = folders.length;
  return `<div class="storage-folders">
    <div class="storage-folders-head">Used by me in <span class="font-mono">${escHtml(m.key)}</span> · ${n} folder${n === 1 ? "" : "s"}</div>
    ${rows}
  </div>`;
}

// --- Helpers ---

function humanBytes(n) {
  if (n == null || isNaN(n)) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const val = n / Math.pow(1024, i);
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

function buildStorageBar(m) {
  const t = m.total_bytes || 0;
  if (t === 0) return '<div class="avail-bar"></div>';
  // du timed out: we know used vs free from df, but not the me/others split.
  if (m.user_measured === false) {
    const pUsed = (m.used_bytes / t * 100).toFixed(1);
    const pFree = (m.avail_bytes / t * 100).toFixed(1);
    const title = `used ${humanBytes(m.used_bytes)} · free ${humanBytes(m.avail_bytes)} (your share not measured — du timed out)`;
    return `<div class="avail-bar" title="${escHtml(title)}">
      <div class="seg-storage-others" style="width:${pUsed}%"></div>
      <div class="seg-storage-free" style="width:${pFree}%"></div>
    </div>`;
  }
  const pMe = (m.user_bytes / t * 100).toFixed(1);
  const pOthers = (m.others_bytes / t * 100).toFixed(1);
  const pFree = (m.avail_bytes / t * 100).toFixed(1);
  const title = `me ${humanBytes(m.user_bytes)} · others ${humanBytes(m.others_bytes)} · free ${humanBytes(m.avail_bytes)}`;
  return `<div class="avail-bar" title="${escHtml(title)}">
    <div class="seg-storage-me" style="width:${pMe}%"></div>
    <div class="seg-storage-others" style="width:${pOthers}%"></div>
    <div class="seg-storage-free" style="width:${pFree}%"></div>
  </div>`;
}

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
  d.textContent = s == null ? "" : s;
  return d.innerHTML;
}

function saveStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Ignore storage failures so the dashboard keeps working normally.
  }
}

function loadStoredValue(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

function loadStoredBoolean(key, fallback) {
  const value = loadStoredValue(key, null);
  if (value === null) return fallback;
  return value === "true";
}

function isValidTab(tab) {
  return tab === "gpu" || tab === "cpu" || tab === "jobs" || tab === "storage";
}

function initializeUiState() {
  const accessibleCheckbox = document.getElementById("filter-accessible");
  const hideDownCheckbox = document.getElementById("filter-hide-down");

  accessibleCheckbox.checked = loadStoredBoolean(STORAGE_KEYS.accessibleOnly, accessibleCheckbox.checked);
  hideDownCheckbox.checked = loadStoredBoolean(STORAGE_KEYS.hideDown, hideDownCheckbox.checked);

  const storedTab = loadStoredValue(STORAGE_KEYS.activeTab, activeTab);
  switchTab(isValidTab(storedTab) ? storedTab : activeTab, { persist: false, fetchIfNeeded: false });
}

function getNodeFilters() {
  return {
    search: document.getElementById("search").value.toLowerCase(),
    accessibleOnly: document.getElementById("filter-accessible").checked,
    hideDown: document.getElementById("filter-hide-down").checked,
  };
}

function nodeMatchesFilters(node, filters) {
  if (filters.search && !node.name.toLowerCase().includes(filters.search)) return false;
  if (filters.accessibleOnly && !node.accessible) return false;
  if (filters.hideDown && (node.state === "down" || node.state === "drain")) return false;
  return true;
}

function sumGroupTotals(groups) {
  return groups.reduce((totals, group) => {
    totals.total += group.total || 0;
    totals.allocated += group.allocated || 0;
    totals.available += group.available || 0;
    totals.down += group.down || 0;
    return totals;
  }, { total: 0, allocated: 0, available: 0, down: 0 });
}

function filterGpuTypes(gpuTypes) {
  const filters = getNodeFilters();
  return gpuTypes
    .map(g => {
      const nodes = g.nodes.filter(node => nodeMatchesFilters(node, filters));
      if (nodes.length === 0) return null;
      return {
        ...g,
        total: nodes.reduce((sum, node) => sum + node.gpu_total, 0),
        allocated: nodes.reduce((sum, node) => sum + node.gpu_allocated, 0),
        available: nodes.reduce((sum, node) => sum + node.gpu_available, 0),
        down: nodes.reduce((sum, node) => sum + node.gpu_down, 0),
        nodes,
        partitions: [...new Set(nodes.flatMap(node => node.partitions))],
        accessible: nodes.some(node => node.accessible),
      };
    })
    .filter(Boolean);
}

function filterCpuTypes(cpuTypes) {
  const filters = getNodeFilters();
  return cpuTypes
    .map(g => {
      const nodes = g.nodes.filter(node => nodeMatchesFilters(node, filters));
      if (nodes.length === 0) return null;
      return {
        ...g,
        total: nodes.reduce((sum, node) => sum + node.cpu_total, 0),
        allocated: nodes.reduce((sum, node) => sum + node.cpu_allocated, 0),
        available: nodes.reduce((sum, node) => sum + node.cpu_available, 0),
        down: nodes.reduce((sum, node) => sum + node.cpu_down, 0),
        mem_total_mb: nodes.reduce((sum, node) => sum + node.mem_total_mb, 0),
        mem_allocated_mb: nodes.reduce((sum, node) => sum + node.mem_allocated_mb, 0),
        mem_available_mb: nodes.reduce((sum, node) => sum + node.mem_available_mb, 0),
        mem_down_mb: nodes.reduce((sum, node) => sum + node.mem_down_mb, 0),
        nodes,
        partitions: [...new Set(nodes.flatMap(node => node.partitions))],
        accessible: nodes.some(node => node.accessible),
      };
    })
    .filter(Boolean);
}

// --- Filter listeners ---

function reRenderActiveTable() {
  if (activeTab === "gpu" && currentData) {
    render(currentData);
  } else if (activeTab === "cpu" && currentCpuData) {
    renderCpu(currentCpuData);
  }
}

document.getElementById("search").addEventListener("input", reRenderActiveTable);
document.getElementById("filter-accessible").addEventListener("change", (event) => {
  saveStoredValue(STORAGE_KEYS.accessibleOnly, String(event.target.checked));
  reRenderActiveTable();
});
document.getElementById("filter-hide-down").addEventListener("change", (event) => {
  saveStoredValue(STORAGE_KEYS.hideDown, String(event.target.checked));
  reRenderActiveTable();
});

// --- Init ---

initializeUiState();
fetchData();
// fetchData() only covers the auto-refreshing tabs; if storage is the restored
// active tab, lazy-load it once here (preserving the no-auto-refresh behavior).
if (activeTab === "storage" && !storageLoaded) fetchStorageData();
startTimer();
