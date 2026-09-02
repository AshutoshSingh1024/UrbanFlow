// ---------------- GLOBAL DEFINITIONS ----------------
const CATEGORY_META = {
  signal_failure: { label: "Traffic Signal", color: "#ef4444" },
  accident: { label: "Road Accident", color: "#dc2626" },
  pothole: { label: "Road Damage", color: "#f97316" },
  waterlogging: { label: "Waterlogging", color: "#3b82f6" },
  open_manhole: { label: "Open Manhole", color: "#ea580c" },
  fire: { label: "Fire Outbreak", color: "#e11d48" },
  trash: { label: "Garbage Overflow", color: "#22c55e" },
  dead_animal: { label: "Dead Animal", color: "#d97706" },
  open_sewage: { label: "Open Sewage", color: "#84cc16" },
  bus_breakdown: { label: "Bus Breakdown", color: "#8b5cf6" },
};

let currentUser = null;
let currentDepartment = "Admin";
let map = null, fullMap = null;
let markersLayer = null, fullMarkersLayer = null;
let issuesCache = [];
let allIssuesMasterCache = [];
let noticesCache = [];
let donutChartInstance = null;
let pendingCoords = { lat: 18.5204, lng: 73.8567, locality: "Pune Central" };

// ---------------- DYNAMIC TRANSLATION ENGINE ----------------
let currentLang = "en";
const clientTranslationCache = { en: {}, hi: {}, mr: {} };

async function translateTextList(texts, targetLang) {
  if (targetLang === "en") {
    const direct = {};
    texts.forEach(t => direct[t] = t);
    return direct;
  }

  const missing = [];
  const resolved = {};
  texts.forEach(t => {
    const clean = t.trim();
    if (!clean) return;
    if (clientTranslationCache[targetLang][clean]) {
      resolved[clean] = clientTranslationCache[targetLang][clean];
    } else {
      missing.push(clean);
    }
  });

  if (missing.length === 0) return resolved;

  try {
    const res = await fetch("/api/translate/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: missing, target_lang: targetLang })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    for (const [orig, trans] of Object.entries(data.translations)) {
      clientTranslationCache[targetLang][orig] = trans;
      resolved[orig] = trans;
    }
  } catch (err) {
    console.warn("Dynamic translation failed, fallback to original:", err);
    missing.forEach(t => resolved[t] = t);
  }

  return resolved;
}

async function applyDynamicPageTranslation(targetLang) {
  currentLang = targetLang;

  if (targetLang === "en") {
    document.querySelectorAll("[data-original-text]").forEach(el => {
      el.textContent = el.dataset.originalText;
    });
    return;
  }

  const elements = Array.from(document.querySelectorAll(
    ".translatable, .desc-box, .notice-body, .alert-desc, .notice-title, .kpi-label, .meta-label, .kpi-trend"
  ));

  const textsToTranslate = [];
  elements.forEach(el => {
    if (!el.dataset.originalText) {
      el.dataset.originalText = el.textContent.trim();
    }
    textsToTranslate.push(el.dataset.originalText);
  });

  const translations = await translateTextList(textsToTranslate, targetLang);

  elements.forEach(el => {
    const orig = el.dataset.originalText;
    if (translations[orig]) {
      el.textContent = translations[orig];
    }
  });
}

// ---------------- AUTHENTICATION ----------------
function checkSession() {
  const saved = localStorage.getItem("urbanflow_auth");
  if (saved) {
    currentUser = JSON.parse(saved);
    applyUserSession(currentUser);
  } else {
    document.getElementById("authOverlay").classList.remove("hidden");
  }
}

function applyUserSession(user) {
  currentUser = user;
  currentDepartment = user.department;

  document.getElementById("sidebarUserName").textContent = user.name;
  document.getElementById("sidebarRoleLabel").textContent = `${user.id} · ${user.department}`;
  document.getElementById("sidebarAvatar").textContent = user.name.slice(0, 2).toUpperCase();
  document.getElementById("headerGreetingName").textContent = user.name;

  const roleSelect = document.getElementById("roleSelect");
  const deptPill = document.getElementById("deptPillWrapper");
  const adminNav = document.getElementById("navAdminCreateUser");
  const allIssuesNav = document.getElementById("navAllIssuesAdmin");
  const btnOpenNotice = document.getElementById("btnOpenNoticeModal");

  if (user.department === "Admin") {
    deptPill.style.display = "flex";
    roleSelect.disabled = false;
    roleSelect.value = "Admin";
    adminNav.style.display = "flex";
    allIssuesNav.style.display = "flex";
  } else {
    deptPill.style.display = "none";
    roleSelect.value = user.department;
    roleSelect.disabled = true;
    adminNav.style.display = "none";
    allIssuesNav.style.display = "none";
  }

  if (user.department !== "Citizen") {
    btnOpenNotice.style.display = "flex";
  } else {
    btnOpenNotice.style.display = "none";
  }

  document.getElementById("authOverlay").classList.add("hidden");
  initMaps();
  refreshAll();
}

function logout() {
  localStorage.removeItem("urbanflow_auth");
  currentUser = null;
  location.reload();
}

// ---------------- MAP INITIALIZATION ----------------
function initMaps() {
  if (map || typeof L === "undefined") return;
  const puneCenter = [18.5204, 73.8567];

  map = L.map("map", { zoomControl: false }).setView(puneCenter, 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  fullMap = L.map("fullMap", { zoomControl: true }).setView(puneCenter, 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(fullMap);
  fullMarkersLayer = L.layerGroup().addTo(fullMap);

  map.on("click", (e) => resolveAndOpenReportModal(e.latlng.lat, e.latlng.lng));
  fullMap.on("click", (e) => resolveAndOpenReportModal(e.latlng.lat, e.latlng.lng));
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

// ---------------- LOCALITY REVERSE GEOCODING ----------------
async function resolveAndOpenReportModal(lat, lng) {
  try {
    const res = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    pendingCoords = { lat, lng, locality: data.locality };
    document.getElementById("reportLocationDisplay").value = `${data.locality} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    document.getElementById("coordsSubtext").textContent = `Locality: ${data.locality} (Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)})`;
  } catch (err) {
    pendingCoords = { lat, lng, locality: "Pune Central" };
    document.getElementById("reportLocationDisplay").value = `Pune Central (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  }
  document.getElementById("reportModal").classList.remove("hidden");
}

function autoDetectGps() {
  document.getElementById("reportLocationDisplay").value = "Detecting live GPS locality...";
  if (!navigator.geolocation) {
    resolveAndOpenReportModal(18.5204, 73.8567);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => resolveAndOpenReportModal(pos.coords.latitude, pos.coords.longitude),
    () => resolveAndOpenReportModal(18.5204, 73.8567),
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

// ---------------- DATA FETCH & REFRESH ----------------
async function refreshAll() {
  try {
    const deptParam = currentDepartment ? `&department=${encodeURIComponent(currentDepartment)}` : "";
    const [issuesRes, statsRes, allIssuesRes, noticesRes] = await Promise.all([
      fetch(`/api/issues?status=open${deptParam}`),
      fetch(`/api/stats?${deptParam.replace('&', '')}`),
      fetch(`/api/issues`),
      fetch(`/api/notices`)
    ]);

    issuesCache = await issuesRes.json();
    const stats = await statsRes.json();
    allIssuesMasterCache = await allIssuesRes.json();
    noticesCache = await noticesRes.json();

    renderDashboard(issuesCache, stats);
    renderFullMapView();
    renderIssuesTable();
    renderAlertsPanel();
    renderNotices(noticesCache);

    if (currentUser && currentUser.department === "Admin") {
      renderAdminMasterIssuesTable();
    }

    if (currentLang !== "en") {
      await applyDynamicPageTranslation(currentLang);
    }
  } catch (err) {
    console.error("Refresh error:", err);
  }
}

function renderDashboard(issues, stats) {
  document.getElementById("kpiTotal").textContent = (stats.total_open || 0) + (stats.total_resolved || 0);
  document.getElementById("kpiOpen").textContent = stats.total_open || 0;
  document.getElementById("kpiResolved").textContent = stats.total_resolved || 0;
  
  const criticalCount = issues.filter(i => getSeverity(i.category) === "critical" || getSeverity(i.category) === "high").length;
  document.getElementById("kpiCritical").textContent = criticalCount;
  document.getElementById("badgeCritical").textContent = criticalCount;

  if (markersLayer) {
    markersLayer.clearLayers();
    issues.forEach(issue => {
      const meta = CATEGORY_META[issue.category] || { color: "#64748b" };
      const marker = L.circleMarker([issue.lat, issue.lng], {
        radius: 8,
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
  const recentSlice = [...issues].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 4);

  if (recentSlice.length === 0) {
    recentList.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:8px 0" class="translatable">No active alerts for this department.</div>`;
  } else {
    recentList.innerHTML = recentSlice.map(issue => {
      const meta = CATEGORY_META[issue.category] || { label: issue.category, color: "#64748b" };
      const sev = getSeverity(issue.category);
      return `
        <div class="compact-issue-item" onclick="openDetailModalById('${issue.id}')">
          <div class="item-left">
            <span class="item-dot" style="background:${meta.color}"></span>
            <div>
              <div class="item-title translatable">${meta.label}</div>
              <div class="item-sub">${issue.near} • ${timeAgo(issue.created_at)}</div>
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
  const labels = ["Traffic", "Road Damage", "Waterlogging", "Sanitation", "Transit/Other"];
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
      datasets: [{ data: counts, backgroundColor: colors, borderWidth: 2, borderColor: "#ffffff" }]
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
          <span class="dot-color" style="background:${colors[idx]}"></span> <span class="translatable">${label}</span>
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

  const filtered = issuesCache.filter(i => {
    const matchCat = catFilter === "all" || i.category === catFilter;
    const matchStat = statFilter === "all" || i.status === statFilter;
    return matchCat && matchStat;
  });

  filtered.forEach(issue => {
    const meta = CATEGORY_META[issue.category] || { color: "#64748b", label: issue.category };
    const marker = L.circleMarker([issue.lat, issue.lng], {
      radius: 8,
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
  const filtered = issuesCache.filter(i => statFilter === "all" || i.status === statFilter);

  document.getElementById("tableDeptHeader").textContent = `${currentDepartment} Incidents & Audit Log`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;" class="translatable">No issues recorded under this department.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(issue => {
    const meta = CATEGORY_META[issue.category] || { label: issue.category };
    const sev = getSeverity(issue.category);
    return `
      <tr>
        <td><strong class="translatable">${meta.label}</strong></td>
        <td class="desc-box">${issue.description || 'No description'}</td>
        <td><strong>${issue.near}</strong></td>
        <td>${timeAgo(issue.created_at)}</td>
        <td><span class="severity-pill ${sev}">${sev}</span></td>
        <td><span class="severity-pill ${issue.status === 'open' ? 'high' : 'low'}">${issue.status}</span></td>
        <td><button class="link-btn translatable" onclick="openDetailModalById('${issue.id}')">Inspect</button></td>
      </tr>
    `;
  }).join("");
}

function renderAdminMasterIssuesTable() {
  const tbody = document.getElementById("adminMasterIssuesTableBody");
  if (!tbody) return;

  const deptFilter = document.getElementById("adminMasterDeptFilter").value;
  const statusFilter = document.getElementById("adminMasterStatusFilter").value;

  const filtered = allIssuesMasterCache.filter(issue => {
    const matchStatus = statusFilter === "all" || issue.status === statusFilter;
    if (!matchStatus) return false;
    if (deptFilter === "all") return true;

    if (deptFilter === "Traffic Police") return ["signal_failure", "accident"].includes(issue.category);
    if (deptFilter === "Road Maintenance Crew") return ["pothole", "waterlogging", "open_manhole"].includes(issue.category);
    if (deptFilter === "Fire & Rescue Services") return ["fire", "building_collapse"].includes(issue.category);
    if (deptFilter === "Emergency Medical (EMS)") return ["medical_emergency"].includes(issue.category);
    if (deptFilter === "Solid Waste & Sanitation (SWM)") return ["trash", "dead_animal", "open_sewage"].includes(issue.category);
    if (deptFilter === "Transit Team") return ["bus_breakdown"].includes(issue.category);
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;" class="translatable">No matching issues in the city-wide register.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(issue => {
    const meta = CATEGORY_META[issue.category] || { label: issue.category };
    return `
      <tr>
        <td><strong class="translatable">${meta.label}</strong></td>
        <td class="desc-box">${issue.description || 'No description'}</td>
        <td>${issue.near}</td>
        <td><span class="severity-pill low">${issue.reported_by}</span></td>
        <td>${timeAgo(issue.created_at)}</td>
        <td><span class="severity-pill ${issue.status === 'open' ? 'high' : 'low'}">${issue.status}</span></td>
        <td><button class="link-btn translatable" onclick="openDetailModalById('${issue.id}')">Action</button></td>
      </tr>
    `;
  }).join("");
}

function renderNotices(notices) {
  const grid = document.getElementById("noticesFeedGrid");
  if (!grid) return;

  if (notices.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted);" class="translatable">No broadcast advisories currently active.</div>`;
    return;
  }

  grid.innerHTML = notices.map(n => `
    <div class="notice-card priority-${n.priority}">
      <div class="notice-card-top">
        <span class="notice-title translatable">${n.title}</span>
        <span class="severity-pill ${n.priority === 'urgent' ? 'critical' : 'low'}">${n.priority}</span>
      </div>
      <p class="notice-body">${n.content}</p>
      <div class="notice-meta">
        <span>${n.department}</span>
        <span>⏱️ ${timeAgo(n.created_at)}</span>
      </div>
    </div>
  `).join("");
}

function renderAlertsPanel() {
  const container = document.getElementById("alertsFeedGrid");
  if (!container) return;

  document.getElementById("alertsDeptHeader").textContent = `${currentDepartment} — Priority Dispatch Queue`;
  const alerts = issuesCache.filter(i => i.status === "open").sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (alerts.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1; padding: 30px; text-align: center; color: var(--text-muted);" class="translatable">No open emergency alerts pending for this department.</div>`;
    return;
  }

  container.innerHTML = alerts.map(issue => {
    const meta = CATEGORY_META[issue.category] || { label: issue.category };
    const sev = getSeverity(issue.category);
    return `
      <div class="alert-card severity-${sev}">
        <div class="alert-card-top">
          <div class="alert-title-wrap">
            <span class="translatable">${meta.label}</span>
          </div>
          <span class="severity-pill ${sev}">${sev}</span>
        </div>
        <p class="alert-desc">${issue.description || "Incident logged without description."}</p>
        <div class="alert-meta">
          <span>📍 ${issue.near}</span>
          <span>⏱️ ${timeAgo(issue.created_at)}</span>
        </div>
        <button class="btn-inspect-alert translatable" onclick="openDetailModalById('${issue.id}')">View Details / Resolve</button>
      </div>
    `;
  }).join("");
}

// ---------------- DETAILS & MODALS ----------------
function openDetailModalById(id) {
  const issue = allIssuesMasterCache.find(i => i.id === id) || issuesCache.find(i => i.id === id);
  if (issue) openDetailModal(issue);
}

function openDetailModal(issue) {
  const meta = CATEGORY_META[issue.category] || { label: issue.category };
  const sev = getSeverity(issue.category);

  document.getElementById("detailTitle").textContent = meta.label;
  document.getElementById("detailLocationStr").textContent = `${issue.near}, Pune (${issue.lat.toFixed(4)}, ${issue.lng.toFixed(4)})`;
  document.getElementById("detailReportedTime").textContent = `Reported ${timeAgo(issue.created_at)} by ${issue.reported_by}`;
  
  const sevBadge = document.getElementById("detailSeverityBadge");
  sevBadge.textContent = sev;
  sevBadge.className = `severity-pill ${sev}`;

  document.getElementById("detailDescription").textContent = issue.description || "No description provided.";
  document.getElementById("detailCategoryVal").textContent = meta.label;
  document.getElementById("detailCoordsVal").textContent = `${issue.near}`;
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
  if (currentUser && currentUser.department === "Citizen") {
    resPanel.classList.add("hidden");
  } else {
    resPanel.classList.remove("hidden");
    document.getElementById("resolveIssueId").value = issue.id;
    document.getElementById("resolveForm").reset();
  }

  document.getElementById("detailModal").classList.remove("hidden");
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2800);
}

// ---------------- EVENT LISTENERS ----------------
document.addEventListener("DOMContentLoaded", () => {
  checkSession();

  // Dynamic Language Switcher Listener
  document.getElementById("langSelect").addEventListener("change", async (e) => {
    const lang = e.target.value;
    showToast(`Switching language to ${lang.toUpperCase()}...`);
    await applyDynamicPageTranslation(lang);
    showToast(`Translated to ${lang === 'hi' ? 'हिंदी' : lang === 'mr' ? 'मराठी' : 'English'}`);
  });

  // Login Form
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = document.getElementById("loginUserId").value.trim();
    const password = document.getElementById("loginPassword").value;
    const btn = document.getElementById("btnLoginSubmit");

    btn.disabled = true;
    btn.textContent = "Verifying...";

    const formData = new FormData();
    formData.append("user_id", userId);
    formData.append("password", password);

    try {
      const res = await fetch("/api/auth/login", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      localStorage.setItem("urbanflow_auth", JSON.stringify(data.user));
      applyUserSession(data.user);
      showToast(`Authenticated as ${data.user.name} (${data.user.id})`);
    } catch (err) {
      showToast("Authentication failed: Invalid credentials.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Authenticate & Enter";
    }
  });

  // Citizen Guest Access
  document.getElementById("btnCitizenAccess").addEventListener("click", () => {
    const guestUser = { id: "CTZ-GUEST", name: "Pune Citizen", department: "Citizen" };
    localStorage.setItem("urbanflow_auth", JSON.stringify(guestUser));
    applyUserSession(guestUser);
    showToast("Entered in Citizen Reporting mode.");
  });

  document.getElementById("btnLogout").addEventListener("click", logout);

  // Navigation Switching
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
      if (view === "all-issues") {
        document.getElementById("viewAllIssuesAdmin").classList.add("active");
        renderAdminMasterIssuesTable();
      }
      if (view === "notices") {
        document.getElementById("viewNotices").classList.add("active");
      }
      if (view === "alerts") {
        document.getElementById("viewAlerts").classList.add("active");
        renderAlertsPanel();
      }
      if (view === "admin-users") {
        document.getElementById("viewAdminUsers").classList.add("active");
      }
    });
  });

  document.getElementById("linkViewAllIssues").addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector('.nav-item[data-view="issues"]').click();
  });

  document.getElementById("roleSelect").addEventListener("change", (e) => {
    currentDepartment = e.target.value;
    refreshAll();
    showToast(`Switched perspective to ${currentDepartment}`);
  });

  // Master Filter Handlers
  document.getElementById("adminMasterDeptFilter").addEventListener("change", renderAdminMasterIssuesTable);
  document.getElementById("adminMasterStatusFilter").addEventListener("change", renderAdminMasterIssuesTable);

  // Department Table & Map Filters
  document.getElementById("issuesStatusFilter").addEventListener("change", renderIssuesTable);
  document.getElementById("mapFilterCategory").addEventListener("change", renderFullMapView);
  document.getElementById("mapFilterStatus").addEventListener("change", renderFullMapView);

  // Modals & GPS
  document.getElementById("btnOpenReport").addEventListener("click", () => autoDetectGps());
  document.getElementById("btnCancelReport").addEventListener("click", () => document.getElementById("reportModal").classList.add("hidden"));
  document.getElementById("btnCloseReportX").addEventListener("click", () => document.getElementById("reportModal").classList.add("hidden"));
  document.getElementById("btnCloseDetail").addEventListener("click", () => document.getElementById("detailModal").classList.add("hidden"));
  document.getElementById("btnRefreshGps").addEventListener("click", autoDetectGps);

  // Notice Form Handling
  document.getElementById("btnOpenNoticeModal").addEventListener("click", () => {
    document.getElementById("noticeModal").classList.remove("hidden");
  });
  document.getElementById("btnCloseNoticeModal").addEventListener("click", () => {
    document.getElementById("noticeModal").classList.add("hidden");
  });

  document.getElementById("noticeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("noticeTitle").value;
    const content = document.getElementById("noticeContent").value;
    const priority = document.getElementById("noticePriority").value;

    const formData = new FormData();
    formData.append("title", title);
    formData.append("content", content);
    formData.append("priority", priority);
    formData.append("department", currentUser.department);
    formData.append("posted_by", `${currentUser.name} (${currentUser.id})`);

    try {
      const res = await fetch("/api/notices", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      showToast("Municipal advisory published successfully.");
      document.getElementById("noticeModal").classList.add("hidden");
      document.getElementById("noticeForm").reset();
      refreshAll();
    } catch (err) {
      showToast("Failed to post notice. Permissions denied.");
    }
  });

  // Report Submission
  document.getElementById("reportForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    formData.append("lat", pendingCoords.lat);
    formData.append("lng", pendingCoords.lng);
    formData.append("reported_by", currentUser ? currentUser.id : "citizen");

    const submitBtn = document.getElementById("btnSubmitReport");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      const res = await fetch("/api/issues", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      showToast("Incident alert registered successfully.");
      document.getElementById("reportModal").classList.add("hidden");
      form.reset();
      refreshAll();
    } catch (err) {
      showToast("Error submitting issue report.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Incident Alert";
    }
  });

  // Resolution Submission
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
    formData.append("resolved_by", currentUser ? `${currentUser.id} (${currentUser.name})` : "field_staff");

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