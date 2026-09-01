const CATEGORY_COLORS = {
  pothole: "#f59e0b",
  signal_failure: "#ef4444",
  waterlogging: "#38bdf8",
  bus_breakdown: "#a78bfa",
};

const RISK_COLORS = {
  low: "#34d399",
  medium: "#fbbf24",
  high: "#f87171",
};

const CATEGORY_LABELS = {
  pothole: "Pothole",
  signal_failure: "Signal failure",
  waterlogging: "Waterlogging",
  bus_breakdown: "Bus breakdown",
};

const POLL_MS = 10000;

let map;
let markersLayer;
let corridorLayer;
let activeFilter = "all";
let pendingLatLng = null;
let issuesCache = [];

function initMap() {
  map = L.map("map", { zoomControl: true }).setView([18.5300, 73.8400], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  corridorLayer = L.layerGroup().addTo(map);

  map.on("click", (e) => openReportModal(e.latlng));
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function renderMarkers(issues) {
  markersLayer.clearLayers();
  const filtered = issues.filter(
    (i) => i.status === "open" && (activeFilter === "all" || i.category === activeFilter)
  );

  filtered.forEach((issue) => {
    const color = CATEGORY_COLORS[issue.category] || "#94a3b8";
    const marker = L.circleMarker([issue.lat, issue.lng], {
      radius: 8,
      fillColor: color,
      color: "#0a0f1a",
      weight: 2,
      fillOpacity: 0.9,
    });

    const photoHtml = issue.photo_url
      ? `<img src="${issue.photo_url}" style="width:100%;border-radius:6px;margin-top:6px" />`
      : "";
    const dupHtml =
      issue.duplicate_count > 1
        ? `<div style="margin-top:4px;font-size:11px;color:#8ea0bd">Reported ${issue.duplicate_count}× by nearby users</div>`
        : "";

    marker.bindPopup(
      `<strong>${CATEGORY_LABELS[issue.category] || issue.category}</strong><br/>
       <span style="font-size:12px;color:#c7d2e5">${issue.description || ""}</span>
       ${dupHtml}${photoHtml}
       <div style="margin-top:6px;font-size:10.5px;color:#8ea0bd">
         Reported by ${issue.reported_by} · ${timeAgo(issue.created_at)}
       </div>`
    );

    marker.addTo(markersLayer);
  });
}

function renderIssueList(issues) {
  const list = document.getElementById("issueList");
  const filtered = issues
    .filter((i) => i.status === "open" && (activeFilter === "all" || i.category === activeFilter))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (filtered.length === 0) {
    list.innerHTML = `<div style="color:var(--text-dim);font-size:12px;padding:8px 0">No open issues in this filter.</div>`;
    return;
  }

  list.innerHTML = filtered
    .map(
      (issue) => `
      <div class="issue-card">
        <div class="issue-card-top">
          <span class="issue-dot" style="background:${CATEGORY_COLORS[issue.category]}"></span>
          <span class="issue-cat">${CATEGORY_LABELS[issue.category] || issue.category}</span>
          <span class="issue-near">${issue.near ? "near " + issue.near : ""}</span>
        </div>
        <div class="issue-desc">${issue.description || "No description provided."}</div>
        <div class="issue-meta">
          <span>${issue.reported_by}</span>
          <span>${timeAgo(issue.created_at)}</span>
        </div>
      </div>`
    )
    .join("");
}

function renderStats(issues) {
  const open = issues.filter((i) => i.status === "open").length;
  const resolved = issues.length - open;
  document.getElementById("statOpen").textContent = open;
  document.getElementById("statResolved").textContent = resolved;
}

function renderCorridors(data) {
  corridorLayer.clearLayers();
  document.getElementById("statPeak").textContent = data.peak_hour ? "Yes" : "No";

  const list = document.getElementById("corridorList");
  list.innerHTML = data.corridors
    .map(
      (c) => `
      <div class="corridor-card level-${c.level}">
        <div class="corridor-name">${c.name}</div>
        <div class="corridor-meta">
          <span>Risk score ${c.risk_score}</span>
          <span>${c.open_issues_nearby} issue(s) nearby</span>
        </div>
      </div>`
    )
    .join("");

  data.corridors.forEach((c) => {
    L.polyline(c.coords, {
      color: RISK_COLORS[c.level],
      weight: 6,
      opacity: 0.75,
    })
      .bindTooltip(`${c.name} — ${c.level.toUpperCase()} risk`)
      .addTo(corridorLayer);
  });
}

async function refreshAll() {
  try {
    const [issuesRes, predRes, statsRes] = await Promise.all([
      fetch("/api/issues"),
      fetch("/api/predictions"),
      fetch("/api/stats"),
    ]);
    const issues = await issuesRes.json();
    const predictions = await predRes.json();

    issuesCache = issues;
    renderMarkers(issues);
    renderIssueList(issues);
    renderStats(issues);
    renderCorridors(predictions);

    document.getElementById("liveLabel").textContent =
      "Live · updated " + new Date().toLocaleTimeString();
  } catch (err) {
    document.getElementById("liveLabel").textContent = "Live · connection issue, retrying…";
    console.error(err);
  }
}

// ---------------- Report modal ----------------
function openReportModal(latlng) {
  pendingLatLng = latlng;
  document.getElementById("modalCoords").textContent =
    `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  document.getElementById("reportModal").classList.remove("hidden");
}

function closeReportModal() {
  document.getElementById("reportModal").classList.add("hidden");
  document.getElementById("reportForm").reset();
  pendingLatLng = null;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2600);
}

async function submitReport(e) {
  e.preventDefault();
  if (!pendingLatLng) return;

  const form = document.getElementById("reportForm");
  const formData = new FormData(form);
  formData.append("lat", pendingLatLng.lat);
  formData.append("lng", pendingLatLng.lng);
  formData.append("reported_by", document.getElementById("roleSelect").value === "Citizen" ? "citizen" : "field_staff");

  const submitBtn = form.querySelector(".btn-primary");
  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";

  try {
    const res = await fetch("/api/issues", { method: "POST", body: formData });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    showToast(data.merged_into ? "Matched an existing nearby report" : "Issue reported — thank you");
    closeReportModal();
    refreshAll();
  } catch (err) {
    showToast("Could not submit report — check the server console");
    console.error(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit report";
  }
}

// ---------------- Wiring ----------------
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  refreshAll();
  setInterval(refreshAll, POLL_MS);

  document.getElementById("cancelReport").addEventListener("click", closeReportModal);
  document.getElementById("reportForm").addEventListener("submit", submitReport);

  document.getElementById("filterRow").addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-chip");
    if (!btn) return;
    document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    renderMarkers(issuesCache);
    renderIssueList(issuesCache);
  });

  document.getElementById("roleSelect").addEventListener("change", (e) => {
    showToast(`Now viewing the same live map as: ${e.target.value}`);
  });
});
