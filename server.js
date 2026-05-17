const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const nodemailer = require("nodemailer");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const formidable = require("formidable");

// --- CONFIGURATION ---
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@crm.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA_DIR, "database.sqlite");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const roles = new Set(["admin", "manager", "sales", "customer"]);
const staffRoles = ["admin", "manager", "sales"];
const statuses = new Set(["new", "contacted", "converted"]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

let db;

// --- DATABASE INITIALIZATION ---
async function ensureDatabase() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL,
      role TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, company TEXT,
      source TEXT, status TEXT NOT NULL DEFAULT 'new', message TEXT, customerId TEXT, assignedTo TEXT,
      assignedBy TEXT, submittedBy TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, leadId TEXT NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL,
      createdBy TEXT NOT NULL, createdByRole TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'customer'
    );
    CREATE TABLE IF NOT EXISTS email_outbox (
      id TEXT PRIMARY KEY, recipient_to TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL,
      leadId TEXT, type TEXT, status TEXT NOT NULL DEFAULT 'queued', error TEXT, createdAt TEXT NOT NULL, sentAt TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, leadId TEXT NOT NULL, filename TEXT NOT NULL, originalName TEXT NOT NULL,
      mimeType TEXT NOT NULL, size INTEGER NOT NULL, uploadedBy TEXT NOT NULL, createdAt TEXT NOT NULL,
      FOREIGN KEY (leadId) REFERENCES leads(id) ON DELETE CASCADE
    );
  `);
  
  try {
    await db.exec("ALTER TABLE files ADD COLUMN uploadedByRole TEXT DEFAULT 'team'");
  } catch (e) {}

  const adminUser = await db.get('SELECT id FROM users WHERE role = ?', ['admin']);
  if (!adminUser) {
    const now = new Date().toISOString();
    await insertUser(createUserRecord("Admin Owner", ADMIN_EMAIL, ADMIN_PASSWORD, "admin", now));
    await insertUser(createUserRecord("Sales Manager", "manager@crm.local", "manager123", "manager", now));
    await insertUser(createUserRecord("Sales Agent", "sales@crm.local", "sales123", "sales", now));

    const lead1Id = crypto.randomUUID();
    await insertLead({
      id: lead1Id, name: "Anika Sharma", email: "anika@example.com", phone: "+91 98765 43210",
      company: "BrightPixel Studio", source: "Website Contact Form", status: "new",
      message: "Interested in a brand website and monthly maintenance.", customerId: null,
      assignedTo: null, assignedBy: null, submittedBy: "Anika Sharma", createdAt: now, updatedAt: now
    });
    await db.run('INSERT INTO notes (id, leadId, text, createdAt, createdBy, createdByRole, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)', 
      [crypto.randomUUID(), lead1Id, "Send portfolio and discovery call slots.", now, "Admin Owner", "admin", "customer"]);

    await insertLead({
      id: crypto.randomUUID(), name: "Rahul Mehta", email: "rahul@example.com", phone: "+91 91234 56780",
      company: "Northstar Foods", source: "Referral", status: "contacted",
      message: "Needs a lead capture landing page for a new product.", customerId: null,
      assignedTo: null, assignedBy: null, submittedBy: "Rahul Mehta", createdAt: now, updatedAt: now
    });
  }
}

async function insertUser(u) {
  await db.run('INSERT INTO users (id, name, email, passwordHash, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [u.id, u.name, u.email, u.passwordHash, u.role, u.createdAt, u.updatedAt]);
}

async function insertLead(l) {
  await db.run('INSERT INTO leads (id, name, email, phone, company, source, status, message, customerId, assignedTo, assignedBy, submittedBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [l.id, l.name, l.email, l.phone, l.company, l.source, l.status, l.message, l.customerId, l.assignedTo, l.assignedBy, l.submittedBy, l.createdAt, l.updatedAt]);
}

// --- UTILITIES & HELPERS ---
function createUserRecord(name, email, password, role, now = new Date().toISOString()) {
  return { id: crypto.randomUUID(), name: String(name || "").trim(), email: String(email || "").trim().toLowerCase(), passwordHash: hashPassword(password), role, createdAt: now, updatedAt: now };
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map(i => i.trim().split("=")).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]));
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, salt, hash] = String(storedHash || "").split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const saved = Buffer.from(hash, "hex");
  return saved.length === candidate.length && crypto.timingSafeEqual(saved, candidate);
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt } : null;
}

async function createSession(res, user) {
  const sessionId = crypto.randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + 86400000; // 24 hours
  await db.run('INSERT INTO sessions (id, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)', [sessionId, user.id, createdAt, expiresAt]);
  res.setHeader("Set-Cookie", `crm_session=${encodeURIComponent(`${sessionId}.${sign(sessionId)}`)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
}

async function getSession(req) {
  const cookie = parseCookies(req).crm_session;
  if (!cookie) return null;
  const [sessionId, signature] = cookie.split(".");
  if (!sessionId || signature !== sign(sessionId)) return null;
  const sessionRecord = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!sessionRecord || sessionRecord.expiresAt < Date.now()) {
    if (sessionRecord) await db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    return null;
  }
  const user = await db.get('SELECT * FROM users WHERE id = ?', [sessionRecord.userId]);
  return user ? { user: publicUser(user) } : null;
}

async function clearSession(req, res) {
  const cookie = parseCookies(req).crm_session;
  if (cookie) await db.run('DELETE FROM sessions WHERE id = ?', [cookie.split(".")[0]]);
  res.setHeader("Set-Cookie", "crm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 1_000_000) throw new Error("Request body is too large.");
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function requireUser(req, res) {
  const session = await getSession(req);
  if (session?.user) return session.user;
  sendJson(res, 401, { error: "Login required." });
  return null;
}

async function addEmailNotification({ to, subject, message, leadId, type }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipients.length) return;
  await db.run('INSERT INTO email_outbox (id, recipient_to, subject, message, leadId, type, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), JSON.stringify(recipients), subject, message, leadId, type, 'queued', new Date().toISOString()]);
}

async function getLeadsWithNotes(filterSql = "", filterParams = []) {
  const leads = await db.all(`SELECT * FROM leads ${filterSql} ORDER BY updatedAt DESC`, filterParams);
  for (const lead of leads) {
    lead.notes = await db.all('SELECT * FROM notes WHERE leadId = ? ORDER BY createdAt DESC', [lead.id]);
    lead.files = await db.all('SELECT * FROM files WHERE leadId = ? ORDER BY createdAt DESC', [lead.id]);
  }
  return leads;
}

// --- ROUTE HANDLERS ---
async function handleLogin(req, res) {
  const body = await readBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (user && verifyPassword(body.password, user.passwordHash)) {
    await createSession(res, user);
    return sendJson(res, 200, { user: publicUser(user) });
  }
  sendJson(res, 401, { error: "Invalid email or password." });
}

async function handleRegister(req, res) {
  const body = await readBody(req);
  if (!body.name) return sendJson(res, 400, { error: "Name is required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return sendJson(res, 400, { error: "Valid email is required." });
  if (String(body.password).length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters." });

  const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [body.email]);
  if (existingUser) return sendJson(res, 409, { error: "An account with this email already exists." });

  const user = createUserRecord(body.name, body.email, body.password, "customer");
  await insertUser(user);
  await createSession(res, user);
  sendJson(res, 201, { user: publicUser(user) });
}

async function handleCreateUser(req, res, currentUser) {
  if (currentUser.role !== "admin") return sendJson(res, 403, { error: "Permission denied." });
  const body = await readBody(req);
  if (!staffRoles.includes(body.role)) return sendJson(res, 400, { error: "Role must be admin, manager, or sales." });
  
  const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [body.email]);
  if (existingUser) return sendJson(res, 409, { error: "Email already exists." });

  const user = createUserRecord(body.name, body.email, body.password, body.role);
  await insertUser(user);
  sendJson(res, 201, { user: publicUser(user) });
}

async function handlePublicSubmitLead(req, res) {
  const currentUser = await requireUser(req, res);
  if (!currentUser || currentUser.role !== "customer") return sendJson(res, 403, { error: "Only customers can submit requests." });

  const form = formidable.formidable({ multiples: true, uploadDir: UPLOADS_DIR, keepExtensions: true, maxFileSize: 50 * 1024 * 1024 });
  form.parse(req, async (err, fields, files) => {
    if (err) return sendJson(res, 400, { error: "Form submission failed." });
    
    const getName = (key) => (Array.isArray(fields[key]) ? fields[key][0] : fields[key]) || "";
    
    const name = getName("name");
    const email = getName("email");
    const phone = getName("phone");
    const company = getName("company");
    const source = getName("source");
    const message = getName("message");

    if (!name || !source) return sendJson(res, 400, { error: "Name and Source are required." });

    const newLead = {
      id: crypto.randomUUID(), name: name.trim(), email: email.trim().toLowerCase(),
      phone: phone.trim(), company: company.trim(),
      source: source.trim(), message: message.trim(),
      status: "new", customerId: currentUser.id, assignedTo: null, assignedBy: null,
      submittedBy: currentUser.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await insertLead(newLead);
    
    const uploadedFile = files.file;
    if (uploadedFile) {
      const fileArr = Array.isArray(uploadedFile) ? uploadedFile : [uploadedFile];
      for (const f of fileArr) {
        const fileId = crypto.randomUUID();
        const filename = path.basename(f.filepath || f.newFilename);
        await db.run('INSERT INTO files (id, leadId, filename, originalName, mimeType, size, uploadedBy, uploadedByRole, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [fileId, newLead.id, filename, f.originalFilename, f.mimetype, f.size, currentUser.name, currentUser.role, newLead.createdAt]);
      }
    }
    
    const staffUsers = await db.all("SELECT email FROM users WHERE role IN ('admin', 'manager')");
    await addEmailNotification({
      to: staffUsers.map(u => u.email), subject: `New request from ${newLead.name}`,
      message: `${newLead.name} submitted a new request.`, leadId: newLead.id, type: "lead_submitted"
    });
    
    newLead.notes = [];
    newLead.files = [];
    sendJson(res, 201, { lead: newLead });
  });
}

async function handleGetStaffLeads(req, res, url, currentUser) {
  if (!staffRoles.includes(currentUser.role)) return sendJson(res, 403, { error: "Permission denied." });
  
  let conditions = [];
  let params = [];
  if (currentUser.role === 'sales') { conditions.push("assignedTo = ?"); params.push(currentUser.id); }
  
  const status = url.searchParams.get("status") || "all";
  if (statuses.has(status)) { conditions.push("status = ?"); params.push(status); }
  
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  if (search) {
    conditions.push("(LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(company) LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  const filterSql = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const leads = await getLeadsWithNotes(filterSql, params);
  
  for (const lead of leads) {
    lead.assignedUser = lead.assignedTo ? publicUser(await db.get('SELECT * FROM users WHERE id = ?', [lead.assignedTo])) : null;
  }
  
  const analyticsSql = currentUser.role === 'sales' ? "WHERE assignedTo = ?" : "";
  const analyticsParams = currentUser.role === 'sales' ? [currentUser.id] : [];
  const allLeads = await db.all(`SELECT status FROM leads ${analyticsSql}`, analyticsParams);
  
  const total = allLeads.length;
  const converted = allLeads.filter(l => l.status === "converted").length;
  sendJson(res, 200, {
    leads,
    analytics: { total, new: allLeads.filter(l => l.status === "new").length, contacted: allLeads.filter(l => l.status === "contacted").length, converted, conversionRate: total ? Math.round((converted/total)*100) : 0 }
  });
}

async function handleExportLeadsCsv(req, res, url, currentUser) {
  if (!staffRoles.includes(currentUser.role)) return sendJson(res, 403, { error: "Permission denied." });
  
  let conditions = [];
  let params = [];
  if (currentUser.role === 'sales') { conditions.push("assignedTo = ?"); params.push(currentUser.id); }
  
  const status = url.searchParams.get("status") || "all";
  if (statuses.has(status)) { conditions.push("status = ?"); params.push(status); }
  
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  if (search) {
    conditions.push("(LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(company) LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  const filterSql = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const leads = await getLeadsWithNotes(filterSql, params);
  
  const headers = ["ID", "Name", "Email", "Phone", "Company", "Source", "Status", "Created At"];
  const rows = leads.map(l => [
    l.id, `"${(l.name||'').replace(/"/g, '""')}"`, `"${(l.email||'').replace(/"/g, '""')}"`,
    `"${(l.phone||'').replace(/"/g, '""')}"`, `"${(l.company||'').replace(/"/g, '""')}"`,
    `"${(l.source||'').replace(/"/g, '""')}"`, l.status, l.createdAt
  ].join(","));
  
  const csvContent = headers.join(",") + "\n" + rows.join("\n");
  
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="leads_export_${new Date().toISOString().split('T')[0]}.csv"`
  });
  res.end(csvContent);
}

async function handleUpdateLeadStatus(req, res, leadId, currentUser) {
  if (!staffRoles.includes(currentUser.role)) return sendJson(res, 403, { error: "Permission denied." });
  const lead = await db.get('SELECT * FROM leads WHERE id = ?', [leadId]);
  if (!lead) return sendJson(res, 404, { error: "Not found." });
  if (currentUser.role === "sales" && lead.assignedTo !== currentUser.id) return sendJson(res, 403, { error: "Permission denied." });

  const body = await readBody(req);
  if (!statuses.has(body.status)) return sendJson(res, 400, { error: "Invalid status." });

  const now = new Date().toISOString();
  await db.run('UPDATE leads SET status = ?, updatedAt = ? WHERE id = ?', [body.status, now, leadId]);
  
  if (lead.status !== body.status) {
    await addEmailNotification({
      to: lead.email, subject: `Status updated to ${body.status}`,
      message: `Hi ${lead.name}, your request is now ${body.status}.`, leadId, type: "status_changed"
    });
  }
  sendJson(res, 200, { success: true });
}

async function handleAssignLead(req, res, leadId, currentUser) {
  if (!["admin", "manager"].includes(currentUser.role)) return sendJson(res, 403, { error: "Permission denied." });
  const body = await readBody(req);
  const assignee = await db.get('SELECT * FROM users WHERE id = ? AND role = ?', [body.assignedTo, 'sales']);
  if (!assignee) return sendJson(res, 400, { error: "Assignee not found or not sales." });

  await db.run('UPDATE leads SET assignedTo = ?, assignedBy = ?, updatedAt = ? WHERE id = ?', [assignee.id, currentUser.id, new Date().toISOString(), leadId]);
  sendJson(res, 200, { success: true });
}

async function handleAddNote(req, res, leadId, currentUser) {
  if (!staffRoles.includes(currentUser.role)) return sendJson(res, 403, { error: "Permission denied." });
  const body = await readBody(req);
  if (!body.text) return sendJson(res, 400, { error: "Note text required." });

  const now = new Date().toISOString();
  await db.run('INSERT INTO notes (id, leadId, text, createdAt, createdBy, createdByRole, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), leadId, body.text, now, currentUser.name, currentUser.role, "customer"]);
  await db.run('UPDATE leads SET updatedAt = ? WHERE id = ?', [now, leadId]);
  sendJson(res, 201, { success: true });
}

async function handleAddFile(req, res, leadId, currentUser) {
  if (!staffRoles.includes(currentUser.role)) return sendJson(res, 403, { error: "Permission denied." });
  
  const form = formidable.formidable({ multiples: true, uploadDir: UPLOADS_DIR, keepExtensions: true, maxFileSize: 50 * 1024 * 1024 });
  form.parse(req, async (err, fields, files) => {
    if (err) return sendJson(res, 400, { error: "File upload failed." });
    const uploadedFile = files.file;
    if (!uploadedFile) return sendJson(res, 400, { error: "No file provided." });
    
    const fileArr = Array.isArray(uploadedFile) ? uploadedFile : [uploadedFile];
    const savedFiles = [];
    const now = new Date().toISOString();
    
    for (const f of fileArr) {
      const fileId = crypto.randomUUID();
      const filename = path.basename(f.filepath || f.newFilename);
      
      await db.run('INSERT INTO files (id, leadId, filename, originalName, mimeType, size, uploadedBy, uploadedByRole, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [fileId, leadId, filename, f.originalFilename, f.mimetype, f.size, currentUser.name, currentUser.role, now]);
      
      savedFiles.push({ id: fileId, originalName: f.originalFilename, size: f.size });
    }
    await db.run('UPDATE leads SET updatedAt = ? WHERE id = ?', [now, leadId]);
    sendJson(res, 201, { success: true, files: savedFiles });
  });
}

async function handleDownloadFile(req, res, leadId, fileId, currentUser) {
  let canView = ["admin", "manager"].includes(currentUser.role) || currentUser.role === "sales";
  
  if (!canView && currentUser.role === "customer") {
    const lead = await db.get('SELECT id FROM leads WHERE id = ? AND (customerId = ? OR email = ?)', [leadId, currentUser.id, currentUser.email]);
    if (lead) canView = true;
  }

  if (!canView) return sendJson(res, 403, { error: "Permission denied." });
  
  const fileRecord = await db.get('SELECT * FROM files WHERE id = ? AND leadId = ?', [fileId, leadId]);
  if (!fileRecord) return sendJson(res, 404, { error: "File not found." });
  
  const filePath = path.join(UPLOADS_DIR, fileRecord.filename);
  try {
    const fileData = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": fileRecord.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileRecord.originalName)}"`
    });
    res.end(fileData);
  } catch (err) {
    sendJson(res, 404, { error: "File read error on disk." });
  }
}

async function handleDeleteNote(req, res, leadId, noteId, currentUser) {
  const note = await db.get('SELECT * FROM notes WHERE id = ? AND leadId = ?', [noteId, leadId]);
  if (!note) return sendJson(res, 404, { error: "Not found." });
  if (currentUser.role !== "admin" && note.createdBy !== currentUser.name) return sendJson(res, 403, { error: "Permission denied." });
  
  await db.run('DELETE FROM notes WHERE id = ?', [noteId]);
  sendJson(res, 200, { success: true });
}

async function handleDeleteFile(req, res, leadId, fileId, currentUser) {
  const fileRecord = await db.get('SELECT * FROM files WHERE id = ? AND leadId = ?', [fileId, leadId]);
  if (!fileRecord) return sendJson(res, 404, { error: "Not found." });
  if (fileRecord.uploadedByRole === 'customer') {
    if (currentUser.name !== fileRecord.uploadedBy) {
      return sendJson(res, 403, { error: "Permission denied. Customer files can only be deleted by the customer." });
    }
  } else {
    if (currentUser.role !== "admin" && fileRecord.uploadedBy !== currentUser.name) {
      return sendJson(res, 403, { error: "Permission denied." });
    }
  }
  
  await db.run('DELETE FROM files WHERE id = ?', [fileId]);
  try { await fs.unlink(path.join(UPLOADS_DIR, fileRecord.filename)); } catch(e) {}
  sendJson(res, 200, { success: true });
}

// --- MAIN ROUTER ---
async function handleApi(req, res, url) {
  try {
    const route = `${req.method} ${url.pathname}`;

    // Public Routes
    if (route === "POST /api/login") return await handleLogin(req, res);
    if (route === "POST /api/register") return await handleRegister(req, res);
    if (route === "POST /api/logout") { await clearSession(req, res); return sendJson(res, 200, { ok: true }); }
    if (route === "GET /api/me") return sendJson(res, 200, { user: (await getSession(req))?.user || null });

    // Protected Routes
    const currentUser = await requireUser(req, res);
    if (!currentUser) return; // Response handled inside requireUser

    if (route === "POST /api/public/leads") return await handlePublicSubmitLead(req, res);
    if (route === "GET /api/users") {
      if (currentUser.role !== "admin") return sendJson(res, 403, { error: "Permission denied" });
      return sendJson(res, 200, { users: (await db.all('SELECT * FROM users')).map(publicUser) });
    }
    if (route === "POST /api/users") return await handleCreateUser(req, res, currentUser);
    if (route === "GET /api/team/sales") {
      if (!["admin", "manager"].includes(currentUser.role)) return sendJson(res, 403, { error: "Permission denied" });
      return sendJson(res, 200, { users: (await db.all("SELECT * FROM users WHERE role = 'sales'")).map(publicUser) });
    }
    if (route === "GET /api/customer/leads") {
      if (currentUser.role !== "customer") return sendJson(res, 403, { error: "Permission denied" });
      const leads = await getLeadsWithNotes("WHERE customerId = ? OR email = ?", [currentUser.id, currentUser.email]);
      return sendJson(res, 200, { leads });
    }
    if (route === "GET /api/leads/export") return await handleExportLeadsCsv(req, res, url, currentUser);
    if (route === "GET /api/leads") return await handleGetStaffLeads(req, res, url, currentUser);

    // Dynamic Routes (e.g., /api/leads/123/notes)
    const match = url.pathname.match(/^\/api\/leads\/([^/]+)(?:\/(notes|assign|files)(?:\/([^/]+))?)?$/);
    console.log("DEBUG_ROUTE:", req.method, url.pathname, match);
    if (match) {
      const leadId = match[1];
      const subRoute = match[2];
      const itemId = match[3];
      if (req.method === "PATCH" && !subRoute) return await handleUpdateLeadStatus(req, res, leadId, currentUser);
      if (req.method === "PATCH" && subRoute === "assign") return await handleAssignLead(req, res, leadId, currentUser);
      if (req.method === "POST" && subRoute === "notes") return await handleAddNote(req, res, leadId, currentUser);
      if (req.method === "DELETE" && subRoute === "notes" && itemId) return await handleDeleteNote(req, res, leadId, itemId, currentUser);
      if (req.method === "POST" && subRoute === "files") return await handleAddFile(req, res, leadId, currentUser);
      if (req.method === "GET" && subRoute === "files" && itemId) return await handleDownloadFile(req, res, leadId, itemId, currentUser);
      if (req.method === "DELETE" && subRoute === "files" && itemId) return await handleDeleteFile(req, res, leadId, itemId, currentUser);
    }

    sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    console.error(error);
    const status = error instanceof SyntaxError ? 400 : 500;
    sendJson(res, status, { error: status === 400 ? "Invalid JSON body." : "Server error." });
  }
}

// --- STATIC FILES & SERVER BOOT ---
async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (["/login", "/portal", "/admin"].includes(pathname)) pathname += ".html";

  const requestedPath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!requestedPath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Forbidden." });

  try {
    const file = await fs.readFile(requestedPath);
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(requestedPath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    if (pathname !== "/index.html") return redirect(res, "/");
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
  await serveStatic(req, res, url);
});

let transporter;
async function initMailer() {
  if (!process.env.SMTP_HOST) {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({ host: "smtp.ethereal.email", port: 587, secure: false, auth: { user: testAccount.user, pass: testAccount.pass } });
    console.log(`Test email account: ${testAccount.user}`);
  } else {
    transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: process.env.SMTP_SECURE === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  }
}

async function processEmailQueue() {
  if (!transporter || !db) return;
  try {
    const queuedEmails = await db.all("SELECT * FROM email_outbox WHERE status = 'queued'");
    for (const email of queuedEmails) {
      const recipients = JSON.parse(email.recipient_to);
      try {
        await transporter.sendMail({ from: '"Mini CRM" <noreply@crm.local>', to: recipients.join(", "), subject: email.subject, text: email.message });
        await db.run("UPDATE email_outbox SET status = 'sent', sentAt = ? WHERE id = ?", [new Date().toISOString(), email.id]);
      } catch (error) {
        await db.run("UPDATE email_outbox SET status = 'failed', error = ? WHERE id = ?", [error.message, email.id]);
      }
    }
  } catch (err) { console.error("Email queue error:", err); }
}

ensureDatabase().then(() => initMailer()).then(() => {
  setInterval(processEmailQueue, 10000);
  processEmailQueue();
  server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}).catch(err => {
  console.error("Database init failed:", err);
  process.exit(1);
});
