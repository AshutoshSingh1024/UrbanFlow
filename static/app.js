const CATEGORY_META = {
  signal_failure: { label: "Traffic Signal", color: "#ef4444", icon: "🚦", group: "Traffic" },
  accident: { label: "Road Accident", color: "#dc2626", icon: "💥", group: "Traffic" },
  pothole: { label: "Road Damage", color: "#f97316", icon: "🚧", group: "Road Damage" },
  waterlogging: { label: "Waterlogging", color: "#3b82f6", icon: "💧", group: "Waterlogging" },
  open_manhole: { label: "Open Manhole", color: "#ea580c", icon: "⚠️", group: "Road Damage" },
  fire: { label: "Fire Outbreak", color: "#e11d48", icon: "🔥", group: "Critical" },
  trash: { label: "Garbage Overflow", color: "#22c55e", icon: "🗑️", group: "Garbage" },
  dead_animal: { label: "Dead Animal", color: "#d97706", icon: "🐾", group: "Garbage" },
  open_sewage: { label: "Open Sewage", color: "#84cc16", icon: "🚰", group: "Garbage" },
  bus_breakdown: { label: "Bus Breakdown", color: "#8b5cf6", icon: "🚌", group: "Other" },
};

const ROLE_DEPARTMENTS = {
  "Traffic Police": ["signal_failure", "accident"],
  "Road Maintenance Crew": ["pothole", "waterlogging", "open_manhole"],
  "Fire & Rescue Services": ["fire"],
  "Emergency Medical (EMS)": ["accident"],
  "Solid Waste & Sanitation (SWM)": ["trash", "dead_animal", "open_sewage"],
  "Transit Team": ["bus_breakdown"],
  "Citizen": Object.keys(CATEGORY_META),
};

let map = null;
let fullMap = null;
let markersLayer = null;
let fullMarkersLayer = null;
let issuesCache = [];
let donutChartInstance = null;
let barChartInstance = null;
let currentRole = "Traffic Police";
let selectedSeverity = "high";
let pendingCoords = { lat: 18.5204, lng: 73.8567 };

function initMaps() {
  if (typeof L === "undefined") {
    console.error("Leaflet library not loaded yet.");
    return;
  }

  const puneCenter = [18.5204, 73.8567];

  // Dashboard Map
  const mapEl = document.getElementById("map");
  if (mapEl && !map) {
    map = L.map("map", { zoomControl: false }).setView(puneCenter, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    map.on("click", (e) => openReportModalWithCoords(e.latlng.lat, e.latlng.lng));
  }

  // Full Screen Map View
  const fullMapEl = document.getElementById("fullMap");
  if (fullMapEl && !fullMap) {
    fullMap = L.map("fullMap", { zoomControl: true }).setView(puneCenter, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(fullMap);
    fullMarkersLayer = L.layerGroup().addTo(fullMap);
    fullMap.on("click", (e) => openReportModalWithCoords(e.latlng.lat, e.latlng.lng));
  }
}

function timeAgo(iso) {
  if (!iso) return "just now";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} mins ago`;
  const hrs = (diffMs / 3600000).toFixed(1);
  if (hrs < 24) return `${hrs} hours ago`;
  return `${Math.round(diffMs / 86400000)}d ago`;
}

function getSeverity(category) {
  if (["fire", "accident"].includes(category)) return "critical";
  if (["signal_failure", "pothole"].includes(category)) return "high";
  if (["waterlogging", "open_manhole"].includes(category)) return "medium";
  return "low";
}

function getDepartmentIssues() {
  const allowed = ROLE_DEPARTMENTS[currentRole] || Object.keys(CATEGORY_META);
  return issuesCache.filter(i => allowed.includes(i.category));
}

// ---------------- RENDERERS ----------------
function renderDashboard(issues, stats) {
  const deptIssues = getDepartmentIssues().filter(i => i.status === "open");

  document.getElementById("kpiTotal").textContent = (stats.total_open || 0) + (stats.total_resolved || 0);
  document.getElementById("kpiOpen").textContent = deptIssues.length;
  document.getElementById("kpiResolved").textContent = stats.total_resolved || 0;
  
  const criticalCount = deptIssues.filter(i => getSeverity(i.category) === "critical" || getSeverity(i.category) === "high").length;
  document.getElementById("kpiCritical").textContent = criticalCount;
  document.getElementById("badgeCritical").textContent = criticalCount;

  if (markersLayer) {
    markersLayer.clearLayers();
    deptIssues.forEach(issue => {
      const meta = CATEGORY_META[issue.category] || { color: "#64748b", label: issue.category };
      const marker = L.circleMarker([issue.lat, issue.lng], {
        radius: 9,
        fillColor: meta.color,
        color: "#ffffff",
        weight: 2,
        fillOpacity: 0.95,
      });
      marker.on("click", () => openDetailModal(issue));
      marker.addTo(markersLayer);
    });
  }

  const recentList = document.getElementById("dashboardRecentList");
  const recentSlice = [...deptIssues].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 4);

  if (recentSlice.length === 0) {
    recentList.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No active alerts for ${currentRole}.</div>`;
  } else {
    recentList.innerHTML = recentSlice.map(issue => {
      const meta = CATEGORY_META[issue.category] || { label: issue.category, color: "#64748b" };
      const sev = getSeverity(issue.category);
      return `
        <div class="compact-issue-item" onclick="openDetailModalById('${issue.id}')">
          <div class="item-left">
            <span class="item-dot" style="background:${meta.color}"></span>
            <div>
              <div class="item-title">${meta.label}</div>
              <div class="item-sub">${issue.near ? issue.near + ' • ' : ''}${timeAgo(issue.created_at)}</div>
            </div>
          </div>
          <span class="severity-pill ${sev}">${sev}</span>
        </div>
      `;
    }).join("");
  }

  renderDonutChart(stats.by_category || {});
}

function renderDonutChart(byCategory) {
  const canvas = document.getElementById("categoryDonutChart");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  const labels = ["Traffic", "Road Damage", "Waterlogging", "Garbage", "Other"];
  const counts = [
    (byCategory.signal_failure || 0) + (byCategory.accident || 0),
    (byCategory.pothole || 0) + (byCategory.open_manhole || 0),
    byCategory.waterlogging || 0,
    (byCategory.trash || 0) + (byCategory.dead_animal || 0) + (byCategory.open_sewage || 0),
    (byCategory.bus_breakdown || 0) + (byCategory.fire || 0)
  ];

  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const colors = ["#ef4444", "#f97316", "#3b82f6", "#22c55e", "#8b5cf6"];

  if (donutChartInstance) donutChartInstance.destroy();

  donutChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [{
        data: counts,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: "#ffffff"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      cutout: "70%"
    }
  });

  const legendDiv = document.getElementById("donutLegend");
  legendDiv.innerHTML = labels.map((label, idx) => {
    const pct = Math.round((counts[idx] / total) * 100);
    return `
      <div class="donut-legend-row">
        <span class="donut-legend-label">
          <span class="dot-color" style="background:${colors[idx]}"></span> ${label}
        </span>
        <span class="donut-legend-pct">${pct}%</span>
      </div>
    `;
  }).join("");
}

function renderFullMapView() {
  if (!fullMarkersLayer) return;
  fullMarkersLayer.clearLayers();
  
  const catFilter = document.getElementById("mapFilterCategory").value;
  const statFilter = document.getElementById("mapFilterStatus").value;
  const deptIssues = getDepartmentIssues();

  const filtered = deptIssues.filter(i => {
    const matchCat = catFilter === "all" || i.category === catFilter;
    const matchStat = statFilter === "all" || i.status === statFilter;
    return matchCat && matchStat;
  });

  filtered.forEach(issue => {
    const meta = CATEGORY_META[issue.category] || { color: "#64748b", label: issue.category };
    const marker = L.circleMarker([issue.lat, issue.lng], {
      radius: 9,
      fillColor: meta.color,
      color: "#ffffff",
      weight: 2,
      fillOpacity: 0.95,
    });
    marker.on("click", () => openDetailModal(issue));
    marker.addTo(fullMarkersLayer);
  });
}

function renderIssuesTable() {
  const tbody = document.getElementById("allIssuesTableBody");
  if (!tbody) return;

  const statFilter = document.getElementById("issuesStatusFilter").value;
  const deptIssues = getDepartmentIssues().filter(i => statFilter === "all" || i.status === statFilter);

  document.getElementById("tableDeptHeader").textContent = `${currentRole} Incidents & Audit Log`;

  if (deptIssues.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">No issues found under ${currentRole}.</td></tr>`;
    return;
  }

  tbody.innerHTML = deptIssues.map(issue => {
    const meta = CATEGORY_META[issue.category] || { label: issue.category, icon: "📋" };
    const sev = getSeverity(issue.category);
    return `
      <tr>
        <td><strong>${meta.icon} ${meta.label}</strong></td>
        <td>${issue.description || 'No description provided.'}</td>
        <td>${issue.near ? issue.near : `${issue.lat.toFixed(3)}, ${issue.lng.toFixed(3)}`}</td>
        <td>${timeAgo(issue.created_at)}</td>
        <td><span class="severity-pill ${sev}">${sev}</span></td>
        <td><span class="severity-pill ${issue.status === 'open' ? 'high' : 'low'}">${issue.status}</span></td>
        <td><button class="link-btn" onclick="openDetailModalById('${issue.id}')">Inspect & Action</button></td>
      </tr>
    `;
  }).join("");
}

function renderAlertsPanel() {
  const container = document.getElementById("alertsFeedGrid");
  if (!container) return;

  document.getElementById("alertsDeptHeader").textContent = `${currentRole} — Priority Dispatch Queue`;

  const deptOpenIssues = getDepartmentIssues().filter(i => i.status === "open");
  const alerts = deptOpenIssues.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (alerts.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1; padding: 30px; text-align: center; color: var(--text-muted);">✓ No open emergency alerts pending for ${currentRole}.</div>`;
    return;
  }

  container.innerHTML = alerts.map(issue => {
    const meta = CATEGORY_META[issue.category] || { label: issue.category, icon: "⚠️" };
    const sev = getSeverity(issue.category);
    return `
      <div class="alert-card severity-${sev}">
        <div class="alert-card-top">
          <div class="alert-title-wrap">
            <span>${meta.icon}</span>
            <span>${meta.label}</span>
          </div>
          <span class="severity-pill ${sev}">${sev}</span>
        </div>
        <p class="alert-desc">${issue.description || "Incident logged without description."}</p>
        <div class="alert-meta">
          <span>📍 ${issue.near ? issue.near : `${issue.lat.toFixed(3)}, ${issue.lng.toFixed(3)}`}</span>
          <span>⏱️ ${timeAgo(issue.created_at)}</span>
        </div>
        <button class="btn-inspect-alert" onclick="openDetailModalById('${issue.id}')">View Details / Resolve</button>
      </div>
    `;
  }).join("");
}

function renderAnalyticsView() {
  const canvas = document.getElementById("barAreaChart");
  if (!canvas || typeof Chart === "undefined") return;

  const deptIssues = getDepartmentIssues();
  const areaCounts = {};
  deptIssues.forEach(i => {
    const area = i.near || "Pune Central";
    areaCounts[area] = (areaCounts[area] || 0) + 1;
  });

  const labels = Object.keys(areaCounts);
  const data = Object.values(areaCounts);

  if (barChartInstance) barChartInstance.destroy();

  barChartInstance = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: `${currentRole} Incidents`,
        data: data,
        backgroundColor: "#3b82f6",
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: "#f1f5f9" } },
        x: { grid: { display: false } }
      }
    }
  });
}

function updateDepartmentUI() {
  document.getElementById("sidebarRoleLabel").textContent = currentRole;
  document.getElementById("recentDeptTitle").textContent = `${currentRole} Alerts`;
  
  // Populate category filter dropdown inside Map View specifically for this department
  const allowed = ROLE_DEPARTMENTS[currentRole] || Object.keys(CATEGORY_META);
  const mapCatSelect = document.getElementById("mapFilterCategory");
  mapCatSelect.innerHTML = `<option value="all">All ${currentRole} Categories</option>` + 
    allowed.map(cat => `<option value="${cat}">${CATEGORY_META[cat]?.label || cat}</option>`).join("");

  renderDashboard(issuesCache, {
    total_open: issuesCache.filter(i => i.status === "open").length,
    total_resolved: issuesCache.filter(i => i.status === "resolved").length,
    by_category: calculateStats(issuesCache)
  });
  renderFullMapView();
  renderIssuesTable();
  renderAlertsPanel();
}

function calculateStats(issues) {
  const counts = {};
  issues.forEach(i => counts[i.category] = (counts[i.category] || 0) + 1);
  return counts;
}

async function refreshAll() {
  try {
    const [issuesRes, statsRes] = await Promise.all([
      fetch("/api/issues"),
      fetch("/api/stats")
    ]);
    issuesCache = await issuesRes.json();
    const stats = await statsRes.json();

    updateDepartmentUI();
  } catch (err) {
    console.error("Refresh error:", err);
  }
}

// ---------------- MODALS & ACTIONS ----------------
function openDetailModalById(id) {
  const issue = issuesCache.find(i => i.id === id);
  if (issue) openDetailModal(issue);
}

function openDetailModal(issue) {
  const meta = CATEGORY_META[issue.category] || { label: issue.category, icon: "📋" };
  const sev = getSeverity(issue.category);

  document.getElementById("detailLeadIcon").textContent = meta.icon;
  document.getElementById("detailTitle").textContent = meta.label;
  document.getElementById("detailLocationStr").textContent = issue.near ? `${issue.near}, Pune` : `Coordinates: ${issue.lat}, ${issue.lng}`;
  document.getElementById("detailReportedTime").textContent = `Reported ${timeAgo(issue.created_at)} by ${issue.reported_by}`;
  
  const sevBadge = document.getElementById("detailSeverityBadge");
  sevBadge.textContent = sev;
  sevBadge.className = `severity-pill ${sev}`;

  document.getElementById("detailDescription").textContent = issue.description || "No description provided.";
  document.getElementById("detailCategoryVal").textContent = meta.label;
  document.getElementById("detailCoordsVal").textContent = `${issue.lat}, ${issue.lng}`;
  document.getElementById("detailDuplicatesVal").textContent = `${issue.duplicate_count || 1} report(s)`;

  const photoWrap = document.getElementById("detailPhotoWrap");
  const photoImg = document.getElementById("detailPhotoImg");
  if (issue.photo_url) {
    photoImg.src = issue.photo_url;
    photoWrap.classList.remove("hidden");
  } else {
    photoWrap.classList.add("hidden");
  }

  const resPanel = document.getElementById("resolutionPanel");
  if (currentRole === "Citizen" || issue.status === "resolved") {
    resPanel.classList.add("hidden");
  } else {
    resPanel.classList.remove("hidden");
    document.getElementById("resolveIssueId").value = issue.id;
    document.getElementById("resolveForm").reset();
  }

  document.getElementById("detailModal").classList.remove("hidden");
}

function autoDetectGps() {
  document.getElementById("reportLocationDisplay").value = "Acquiring live GPS signal...";
  if (!navigator.geolocation) {
    openReportModalWithCoords(18.5204, 73.8567, "Pune Central (Default)");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      openReportModalWithCoords(pos.coords.latitude, pos.coords.longitude, "Live Device GPS");
    },
    (err) => {
      openReportModalWithCoords(18.5204, 73.8567, "Pune Central (Fallback)");
    },
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

function openReportModalWithCoords(lat, lng, label = "Selected Location") {
  pendingCoords = { lat, lng };
  document.getElementById("reportLocationDisplay").value = `${label} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  document.getElementById("coordsSubtext").textContent = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
  document.getElementById("reportModal").classList.remove("hidden");
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2800);
}

// ---------------- DOM WIRING ----------------
document.addEventListener("DOMContentLoaded", () => {
  initMaps();
  refreshAll();
  setInterval(refreshAll, 10000);

  // Sidebar navigation tabs
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      item.classList.add("active");

      const view = item.dataset.view;
      document.querySelectorAll(".view-section").forEach(v => v.classList.remove("active"));
      
      if (view === "dashboard") document.getElementById("viewDashboard").classList.add("active");
      if (view === "mapview") {
        document.getElementById("viewMapView").classList.add("active");
        setTimeout(() => fullMap && fullMap.invalidateSize(), 150);
      }
      if (view === "issues") {
        document.getElementById("viewIssues").classList.add("active");
        renderIssuesTable();
      }
      if (view === "alerts") {
        document.getElementById("viewAlerts").classList.add("active");
        renderAlertsPanel();
      }
      if (view === "analytics") {
        document.getElementById("viewAnalytics").classList.add("active");
        renderAnalyticsView();
      }
    });
  });

  document.getElementById("linkViewAllIssues").addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector('.nav-item[data-view="issues"]').click();
  });

  // Department Dropdown change
  document.getElementById("roleSelect").addEventListener("change", (e) => {
    currentRole = e.target.value;
    updateDepartmentUI();
    showToast(`Switched view to ${currentRole}`);
  });

  // Filters inside views
  document.getElementById("issuesStatusFilter").addEventListener("change", renderIssuesTable);
  document.getElementById("mapFilterCategory").addEventListener("change", renderFullMapView);
  document.getElementById("mapFilterStatus").addEventListener("change", renderFullMapView);

  // Modals & controls
  document.getElementById("btnOpenReport").addEventListener("click", () => autoDetectGps());
  document.getElementById("btnCancelReport").addEventListener("click", () => document.getElementById("reportModal").classList.add("hidden"));
  document.getElementById("btnCloseReportX").addEventListener("click", () => document.getElementById("reportModal").classList.add("hidden"));
  document.getElementById("btnCloseDetail").addEventListener("click", () => document.getElementById("detailModal").classList.add("hidden"));
  document.getElementById("btnRefreshGps").addEventListener("click", autoDetectGps);

  // Severity selector
  document.querySelectorAll(".btn-severity").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-severity").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedSeverity = btn.dataset.severity;
    });
  });

  // Report Form Submit
  document.getElementById("reportForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    formData.append("lat", pendingCoords.lat);
    formData.append("lng", pendingCoords.lng);
    formData.append("reported_by", currentRole === "Citizen" ? "citizen" : "field_staff");

    const submitBtn = document.getElementById("btnSubmitReport");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      const res = await fetch("/api/issues", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      showToast("Incident report registered successfully");
      document.getElementById("reportModal").classList.add("hidden");
      form.reset();
      refreshAll();
    } catch (err) {
      showToast("Error submitting issue report.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Alert";
    }
  });

  // Resolution Form Submit
  document.getElementById("resolveForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const issueId = document.getElementById("resolveIssueId").value;
    const fileInput = document.getElementById("resolvePhotoInput");

    if (!fileInput.files.length) {
      showToast("Compulsory: Upload on-site photo proof.");
      return;
    }

    const formData = new FormData();
    formData.append("resolution_photo", fileInput.files[0]);
    formData.append("resolved_by", currentRole);

    try {
      const res = await fetch(`/api/issues/${issueId}/resolve`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      showToast("Issue verified & marked as resolved");
      document.getElementById("detailModal").classList.add("hidden");
      refreshAll();
    } catch (err) {
      showToast("Resolution failed. Check server logs.");
    }
  });
});