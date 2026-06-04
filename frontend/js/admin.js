const AUTH_SESSION_KEY = "smart-alert-auth-session";
const API_BASE = window.SMART_ALERT_API_BASE || (
  window.location.protocol === "file:" || ["4173", "5173"].includes(window.location.port)
    ? "http://localhost:3000"
    : ""
);

let alerts = [];
let contributions = [];

function apiUrl(path) {
  if (!API_BASE) return path;
  return API_BASE.replace(/\/$/, "") + path;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString(navigator.language || "vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(value) {
  return String(value || "new").replace(/_/g, " ");
}

function showToast(title, message) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast-item";
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" type="button" aria-label="Close">×</button>
  `;
  container.appendChild(toast);
  toast.querySelector(".toast-close").addEventListener("click", () => toast.remove());
  setTimeout(() => toast.remove(), 4200);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
  return json;
}

function updateStats() {
  const newAlerts = alerts.filter((item) => item.status === "new").length;
  const approved = contributions.filter((item) => item.status === "approved").length;
  document.getElementById("admin-stat-alerts").textContent = alerts.length;
  document.getElementById("admin-stat-new").textContent = newAlerts;
  document.getElementById("admin-stat-contributions").textContent = contributions.length;
  document.getElementById("admin-stat-approved").textContent = approved;
}

function renderAlerts() {
  const list = document.getElementById("admin-alert-list");
  const status = document.getElementById("admin-alert-filter").value;
  const items = status ? alerts.filter((item) => item.status === status) : alerts;
  if (!items.length) {
    list.innerHTML = `<div class="admin-empty">No alerts match this filter.</div>`;
    return;
  }

  list.innerHTML = items.map((item) => `
    <article class="admin-item">
      <div class="admin-item-main">
        <div class="admin-item-title">${escapeHtml(item.camera_name || item.camera_id)}</div>
        <div class="admin-item-meta">${escapeHtml(item.event_type)} · ${escapeHtml(item.severity)} · ${formatDateTime(item.last_seen)}</div>
      </div>
      <span class="admin-badge ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
      <div class="admin-item-actions">
        <select class="admin-select compact" data-alert-status data-camera-id="${escapeHtml(item.camera_id)}" data-event-type="${escapeHtml(item.event_type)}">
          ${["new", "in_progress", "confirmed", "false_alarm", "resolved"].map((statusOption) =>
            `<option value="${statusOption}" ${item.status === statusOption ? "selected" : ""}>${statusLabel(statusOption)}</option>`
          ).join("")}
        </select>
        <button class="secondary-action compact-action" type="button" data-delete-alert data-camera-id="${escapeHtml(item.camera_id)}" data-event-type="${escapeHtml(item.event_type)}">Delete</button>
      </div>
    </article>
  `).join("");
}

function renderContributions() {
  const list = document.getElementById("admin-contribution-list");
  const status = document.getElementById("admin-contribution-filter").value;
  const items = status ? contributions.filter((item) => item.status === status) : contributions;
  if (!items.length) {
    list.innerHTML = `<div class="admin-empty">No camera contributions match this filter.</div>`;
    return;
  }

  list.innerHTML = items.map((item) => {
    const isPending = item.status === "pending";
    const isPublicVisible = item.privacy?.public_visible !== false;
    const incidentShare = item.privacy?.incident_share !== false;
    const reviewedCopy = item.status === "approved"
      ? isPublicVisible
        ? `Approved as ${escapeHtml(item.camera_id || "community camera")}`
        : "Private camera acknowledged. It was not published on the map."
      : item.status === "rejected"
        ? "Rejected by admin"
        : "";
    const privacyCopy = isPublicVisible
      ? "Visibility: public on map"
      : `Visibility: private · Incident sharing: ${incidentShare ? "yes" : "no"}`;
    return `
    <article class="admin-item">
      <div class="admin-item-main">
        <div class="admin-item-title">${escapeHtml(item.name)}</div>
        <div class="admin-item-meta">${escapeHtml(item.location?.address || "No address")} · ${escapeHtml(item.location?.lat)}, ${escapeHtml(item.location?.lng)}</div>
        <div class="admin-item-note">${escapeHtml(privacyCopy)}</div>
        <div class="admin-item-note">${escapeHtml(item.note || "No contributor note.")}</div>
        ${reviewedCopy ? `<div class="admin-item-note">${reviewedCopy}</div>` : ""}
      </div>
      <span class="admin-badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
      <div class="admin-item-actions">
        ${isPending ? `
          <button class="primary-action compact-action" type="button" data-review-contribution="approve" data-id="${escapeHtml(item.id)}">${isPublicVisible ? "Approve" : "Acknowledge"}</button>
          <button class="secondary-action compact-action" type="button" data-review-contribution="reject" data-id="${escapeHtml(item.id)}">Reject</button>
        ` : ""}
        <button class="secondary-action compact-action danger-action" type="button" data-delete-contribution data-id="${escapeHtml(item.id)}" data-name="${escapeHtml(item.name)}">
          ${item.status === "approved" ? "Delete camera" : "Delete"}
        </button>
      </div>
    </article>
  `;
  }).join("");
}

async function loadAdminData() {
  const queueJson = await fetchJson(apiUrl("/api/events/queue"));
  const contributionJson = await fetchJson(apiUrl("/api/camera-contributions"));
  alerts = Array.isArray(queueJson.queue)
    ? queueJson.queue
    : Array.isArray(queueJson.items)
      ? queueJson.items
      : Array.isArray(queueJson.alerts)
        ? queueJson.alerts
        : [];
  contributions = Array.isArray(contributionJson.contributions) ? contributionJson.contributions : [];
  updateStats();
  renderAlerts();
  renderContributions();
}

async function updateAlertStatus(cameraId, eventType, status) {
  await fetchJson(apiUrl(`/api/events/queue/${encodeURIComponent(cameraId)}/${encodeURIComponent(eventType)}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  showToast("Alert updated", `${cameraId} is now ${statusLabel(status)}.`);
  await loadAdminData();
}

async function deleteAlert(cameraId, eventType) {
  await fetchJson(apiUrl(`/api/events/queue/${encodeURIComponent(cameraId)}/${encodeURIComponent(eventType)}`), {
    method: "DELETE",
  });
  showToast("Alert deleted", `${cameraId} was removed from the queue.`);
  await loadAdminData();
}

async function reviewContribution(id, action) {
  await fetchJson(apiUrl(`/api/camera-contributions/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  showToast("Camera contribution updated", action === "approve" ? "Camera approved." : "Camera rejected.");
  await loadAdminData();
}

async function deleteContribution(id, name) {
  await fetchJson(apiUrl(`/api/camera-contributions/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  showToast("Camera contribution deleted", `${name || "Camera"} was removed.`);
  await loadAdminData();
}

function logout() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  window.location.href = "login.html";
}

document.addEventListener("change", async (event) => {
  const alertSelect = event.target.closest("[data-alert-status]");
  if (alertSelect) {
    await updateAlertStatus(alertSelect.dataset.cameraId, alertSelect.dataset.eventType, alertSelect.value);
    return;
  }

  if (event.target.id === "admin-alert-filter") renderAlerts();
  if (event.target.id === "admin-contribution-filter") renderContributions();
});

document.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-alert]");
  if (deleteButton) {
    await deleteAlert(deleteButton.dataset.cameraId, deleteButton.dataset.eventType);
    return;
  }

  const reviewButton = event.target.closest("[data-review-contribution]");
  if (reviewButton) {
    reviewButton.disabled = true;
    await reviewContribution(reviewButton.dataset.id, reviewButton.dataset.reviewContribution);
    return;
  }

  const contributionDeleteButton = event.target.closest("[data-delete-contribution]");
  if (contributionDeleteButton) {
    const name = contributionDeleteButton.dataset.name || "this camera";
    const ok = window.confirm(`Delete ${name}? Approved cameras will be removed from the map.`);
    if (!ok) return;
    contributionDeleteButton.disabled = true;
    await deleteContribution(contributionDeleteButton.dataset.id, name);
  }
});

document.getElementById("admin-refresh").addEventListener("click", () => {
  loadAdminData().catch((err) => showToast("Refresh failed", err.message));
});
document.getElementById("admin-logout").addEventListener("click", logout);

loadAdminData().catch((err) => showToast("Admin data failed", err.message));
