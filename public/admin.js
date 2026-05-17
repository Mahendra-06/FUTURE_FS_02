const loginView = document.querySelector("#loginView");
const dashboardView = document.querySelector("#dashboardView");
const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const logoutButton = document.querySelector("#logoutButton");
const leadsList = document.querySelector("#leadsList");
const searchInput = document.querySelector("#searchInput");
const statusFilter = document.querySelector("#statusFilter");
const currentUserChip = document.querySelector("#currentUserChip");
const usersPanel = document.querySelector("#usersPanel");
const userForm = document.querySelector("#userForm");
const userFormMessage = document.querySelector("#userFormMessage");
const usersList = document.querySelector("#usersList");

const metricNodes = {
  total: document.querySelector("#totalLeads"),
  new: document.querySelector("#newLeads"),
  contacted: document.querySelector("#contactedLeads"),
  converted: document.querySelector("#convertedLeads"),
  conversionRate: document.querySelector("#conversionRate")
};

const themeToggle = document.getElementById('themeToggle');
if (localStorage.getItem('theme') === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark');
  if (themeToggle) themeToggle.textContent = '☀️';
}
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
      themeToggle.textContent = '🌙';
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
      themeToggle.textContent = '☀️';
    }
  });
}

let debounceTimer;
let currentUser = null;
let salesUsers = [];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function showLogin() {
  currentUser = null;
  loginView.classList.remove("hidden");
  dashboardView.classList.add("hidden");
  usersPanel.classList.add("hidden");
}

function showDashboard() {
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  currentUserChip.textContent = `${currentUser.name} / ${title(currentUser.role)}`;
  usersPanel.classList.toggle("hidden", currentUser.role !== "admin");
}

async function checkSession() {
  const data = await api("/api/me");
  if (data.user) {
    if (data.user.role === "customer") {
      await api("/api/logout", { method: "POST" });
      loginMessage.textContent = "Customer accounts use the customer login page.";
      loginMessage.classList.add("error");
      showLogin();
      return;
    }
    currentUser = data.user;
    showDashboard();
    await loadLeads();
    await maybeLoadUsers();
  } else {
    showLogin();
  }
}

async function loadLeads() {
  if (["admin", "manager"].includes(currentUser.role)) {
    const team = await api("/api/team/sales");
    salesUsers = team.users;
  }
  const params = new URLSearchParams({
    search: searchInput.value.trim(),
    status: statusFilter.value
  });
  const data = await api(`/api/leads?${params}`);
  renderMetrics(data.analytics);
  renderLeads(data.leads);
}

function renderMetrics(analytics) {
  metricNodes.total.textContent = analytics.total;
  metricNodes.new.textContent = analytics.new;
  metricNodes.contacted.textContent = analytics.contacted;
  metricNodes.converted.textContent = analytics.converted;
  metricNodes.conversionRate.textContent = `${analytics.conversionRate}%`;
}

function renderLeads(leads) {
  if (!leads.length) {
    leadsList.innerHTML = '<div class="empty-state">No leads match the current filters.</div>';
    return;
  }

  leadsList.innerHTML = leads.map((lead) => leadTemplate(lead)).join("");

  document.querySelectorAll("[data-status-select]").forEach((select) => {
    select.addEventListener("change", async () => {
      await api(`/api/leads/${select.dataset.leadId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: select.value })
      });
      await loadLeads();
    });
  });

  document.querySelectorAll("[data-assignment-select]").forEach((select) => {
    select.addEventListener("change", async () => {
      await api(`/api/leads/${select.dataset.leadId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assignedTo: select.value })
      });
      await loadLeads();
    });
  });

  document.querySelectorAll("[data-note-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const leadId = form.dataset.leadId;
      const text = form.querySelector("textarea").value.trim();
      if (!text) return;

      await api(`/api/leads/${leadId}/notes`, {
        method: "POST",
        body: JSON.stringify({ text })
      });
      await loadLeads();
    });
  });

  document.querySelectorAll("[data-file-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const leadId = form.dataset.leadId;
      const fileInput = form.querySelector('input[type="file"]');
      if (!fileInput.files.length) return;

      const formData = new FormData();
      for (const file of fileInput.files) {
        formData.append('file', file);
      }

      const submitBtn = form.querySelector('button');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading...';

      try {
        const response = await fetch(`/api/leads/${leadId}/files`, {
          method: "POST",
          body: formData
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Upload failed");
        await loadLeads();
      } catch (err) {
        alert(err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Upload';
      }
    });
  });

  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const leadId = btn.dataset.leadId;
      const type = btn.dataset.type;
      const id = btn.dataset.id;
      
      if (confirm(`Delete this ${type === 'notes' ? 'reply' : 'file'}?`)) {
        try {
          await api(`/api/leads/${leadId}/${type}/${id}`, { method: "DELETE" });
          await loadLeads();
        } catch (err) {
          alert(err.message);
        }
      }
    });
  });
}

async function maybeLoadUsers() {
  if (!currentUser || currentUser.role !== "admin") return;
  const data = await api("/api/users");
  const teamUsers = data.users.filter((user) => user.role !== "customer");
  usersList.innerHTML = teamUsers.map(userTemplate).join("");
}

function userTemplate(user) {
  return `
    <article class="user-row">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <span>${escapeHtml(user.email)}</span>
      </div>
      <span class="role-pill ${escapeHtml(user.role)}">${escapeHtml(user.role)}</span>
    </article>
  `;
}

function leadTemplate(lead) {
  return `
    <article class="lead-card">
      <div class="lead-main">
        <div class="lead-card-top">
          <div>
            <h2>${escapeHtml(lead.name)}</h2>
            <div class="lead-meta">
              ${escapeHtml(lead.email)}${lead.phone ? ` / ${escapeHtml(lead.phone)}` : ""}
            </div>
          </div>
          <span class="status-pill ${escapeHtml(lead.status)}">${escapeHtml(lead.status)}</span>
        </div>
        <div class="lead-facts">
          <span>${lead.company ? escapeHtml(lead.company) : "No company"}</span>
          <span>${escapeHtml(lead.source)}</span>
          <span>${lead.assignedUser ? `Assigned: ${escapeHtml(lead.assignedUser.name)}` : "Unassigned"}</span>
          <span>${formatDate(lead.createdAt)}</span>
        </div>
        <p class="lead-message">${escapeHtml(lead.message || "No message provided.")}</p>
        ${assignmentTemplate(lead)}
        <label>
          Update status
          <select data-status-select data-lead-id="${lead.id}">
            ${["new", "contacted", "converted"]
              .map((status) => `<option value="${status}" ${lead.status === status ? "selected" : ""}>${title(status)}</option>`)
              .join("")}
          </select>
        </label>
      </div>
      <aside class="notes-panel">
        <h3>Customer replies</h3>
        <form class="note-form" data-note-form data-lead-id="${lead.id}">
          <textarea placeholder="Add a customer-visible reply or follow-up update"></textarea>
          <button type="submit">Send reply</button>
        </form>
        ${notesTemplate(lead.notes)}
        
        <h3 style="margin-top: 2rem;">Files & Documents</h3>
        <form class="file-form" data-file-form data-lead-id="${lead.id}" style="display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;">
          <input type="file" name="file" multiple required style="flex: 1;" />
          <button type="submit" class="secondary-button">Upload</button>
        </form>
        ${filesTemplate(lead.files || [])}
      </aside>
    </article>
  `;
}

function assignmentTemplate(lead) {
  if (!["admin", "manager"].includes(currentUser.role)) return "";
  return `
    <label>
      Assign sales person
      <select data-assignment-select data-lead-id="${lead.id}">
        <option value="">Select sales person</option>
        ${salesUsers
          .map((user) => `<option value="${user.id}" ${lead.assignedTo === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function renderBadge(role) {
  if (role === 'customer') return '<span style="background-color: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-left: 4px;">Customer</span>';
  return '<span style="background-color: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-left: 4px;">Team</span>';
}

function notesTemplate(notes) {
  if (!notes.length) return '<p class="lead-meta">No follow-up notes yet.</p>';
  return notes
    .map(
      (note) => `
        <div class="note">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
              <p>${escapeHtml(note.text)}</p>
              <span class="note-date">${formatDate(note.createdAt)}${note.createdBy ? ` by <strong>${escapeHtml(note.createdBy)}</strong>` : ""}${renderBadge(note.createdByRole)}</span>
            </div>
            ${(currentUser && (currentUser.role === 'admin' || currentUser.name === note.createdBy)) ? `<button class="delete-btn" style="background:none; border:none; cursor:pointer; font-size: 1.2rem; margin-left: 0.5rem;" data-lead-id="${note.leadId}" data-type="notes" data-id="${note.id}" title="Delete">🗑️</button>` : ''}
          </div>
        </div>
      `
    )
    .join("");
}

function filesTemplate(files) {
  if (!files.length) return '<p class="lead-meta">No files uploaded yet.</p>';
  return files
    .map(
      (file) => `
        <div class="note">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
              <a href="/api/leads/${file.leadId}/files/${file.id}" target="_blank" download>${escapeHtml(file.originalName)}</a>
              <br/>
              <span class="note-date">${Math.round(file.size / 1024)} KB &middot; ${formatDate(file.createdAt)} uploaded by <strong>${escapeHtml(file.uploadedBy || "Unknown")}</strong>${renderBadge(file.uploadedByRole)}</span>
            </div>
            ${(currentUser && file.uploadedByRole !== 'customer' && (currentUser.role === 'admin' || currentUser.name === file.uploadedBy)) ? `<button class="delete-btn" style="background:none; border:none; cursor:pointer; font-size: 1.2rem; margin-left: 0.5rem;" data-lead-id="${file.leadId}" data-type="files" data-id="${file.id}" title="Delete">🗑️</button>` : ''}
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

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "Checking credentials...";
  loginMessage.classList.remove("error");

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(loginForm).entries()))
    });
    const session = await api("/api/me");
    if (session.user.role === "customer") {
      await api("/api/logout", { method: "POST" });
      throw new Error("Customer accounts cannot access the team dashboard. Use customer login instead.");
    }
    currentUser = session.user;
    loginMessage.textContent = "";
    showDashboard();
    await loadLeads();
    await maybeLoadUsers();
  } catch (error) {
    loginMessage.textContent = error.message;
    loginMessage.classList.add("error");
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showLogin();
});

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  userFormMessage.textContent = "Creating user...";
  userFormMessage.classList.remove("error");

  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(userForm).entries()))
    });
    userForm.reset();
    userFormMessage.textContent = "User created successfully.";
    await maybeLoadUsers();
  } catch (error) {
    userFormMessage.textContent = error.message;
    userFormMessage.classList.add("error");
  }
});

searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadLeads, 250);
});

statusFilter.addEventListener("change", loadLeads);

checkSession().catch(showLogin);
