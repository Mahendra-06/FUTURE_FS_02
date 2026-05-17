const portalLoginView = document.querySelector("#portalLoginView");
const portalView = document.querySelector("#portalView");
const portalUserChip = document.querySelector("#portalUserChip");
const portalLogoutButton = document.querySelector("#portalLogoutButton");
const portalRequestsList = document.querySelector("#portalRequestsList");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

let currentUser = null;

async function loadPortal() {
  const session = await api("/api/me");
  currentUser = session.user;
  if (!currentUser || currentUser.role !== "customer") {
    portalLoginView.classList.remove("hidden");
    portalView.classList.add("hidden");
    return;
  }

  portalUserChip.textContent = `${session.user.name} / Customer`;
  portalLoginView.classList.add("hidden");
  portalView.classList.remove("hidden");

  const data = await api("/api/customer/leads");
  renderRequests(data.leads);
}

function renderRequests(leads) {
  if (!leads.length) {
    portalRequestsList.innerHTML = `
      <div class="empty-state">
        No consultation requests yet. Submit your first request from the website contact section.
      </div>
    `;
    return;
  }

  portalRequestsList.innerHTML = leads.map(requestTemplate).join("");
}

portalRequestsList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  const leadId = btn.dataset.leadId;
  const type = btn.dataset.type;
  const id = btn.dataset.id;
  
  if (confirm(`Delete this ${type === 'notes' ? 'reply' : 'file'}?`)) {
    try {
      await api(`/api/leads/${leadId}/${type}/${id}`, { method: "DELETE" });
      const data = await api("/api/customer/leads");
      renderRequests(data.leads);
    } catch (err) {
      alert(err.message);
    }
  }
});

function requestTemplate(lead) {
  return `
    <article class="portal-request-card">
      <div class="lead-card-top">
        <div>
          <h2>${escapeHtml(lead.company || lead.name)}</h2>
          <div class="lead-meta">${formatDate(lead.createdAt)} / ${escapeHtml(lead.source)}</div>
        </div>
        <span class="status-pill ${escapeHtml(lead.status)}">${escapeHtml(lead.status)}</span>
      </div>
      <p class="lead-message">${escapeHtml(lead.message || "No message provided.")}</p>
      <h3>Team replies</h3>
      ${notesTemplate(lead.notes)}
      <h3 style="margin-top: 1.5rem;">Files & Documents</h3>
      ${filesTemplate(lead.files || [])}
    </article>
  `;
}

function renderBadge(role) {
  if (role === 'customer') return '<span style="background-color: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-left: 4px;">Customer</span>';
  return '<span style="background-color: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-left: 4px;">Team</span>';
}

function notesTemplate(notes) {
  if (!notes.length) return '<p class="lead-meta">No team replies yet.</p>';
  return notes
    .map(
      (note) => `
        <div class="note">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
              <p>${escapeHtml(note.text)}</p>
              <span class="note-date">${formatDate(note.createdAt)} by <strong>${escapeHtml(note.createdBy || "Team")}</strong>${renderBadge(note.createdByRole)}</span>
            </div>
            ${(currentUser && (currentUser.role === 'admin' || currentUser.name === note.createdBy)) ? `<button class="delete-btn" style="background:none; border:none; cursor:pointer; font-size: 1.2rem; margin-left: 0.5rem;" data-lead-id="${note.leadId}" data-type="notes" data-id="${note.id}" title="Delete">🗑️</button>` : ''}
          </div>
        </div>
      `
    )
    .join("");
}

function filesTemplate(files) {
  if (!files.length) return '<p class="lead-meta">No files shared yet.</p>';
  return files
    .map(
      (file) => `
        <div class="note">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
              <a href="/api/leads/${file.leadId}/files/${file.id}" target="_blank" download>${escapeHtml(file.originalName)}</a>
              <br/>
              <span class="note-date">${Math.round(file.size / 1024)} KB &middot; ${formatDate(file.createdAt)} uploaded by <strong>${escapeHtml(file.uploadedBy || "Team")}</strong>${renderBadge(file.uploadedByRole)}</span>
            </div>
            ${(currentUser && (currentUser.role === 'admin' || currentUser.name === file.uploadedBy)) ? `<button class="delete-btn" style="background:none; border:none; cursor:pointer; font-size: 1.2rem; margin-left: 0.5rem;" data-lead-id="${file.leadId}" data-type="files" data-id="${file.id}" title="Delete">🗑️</button>` : ''}
          </div>
        </div>
      `
    )
    .join("");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

portalLogoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  window.location.href = "/";
});

loadPortal().catch(() => {
  portalLoginView.classList.remove("hidden");
  portalView.classList.add("hidden");
});
