# Mini CRM - Client Lead Management System

A full-stack lead management app for storing website inquiries, tracking status, adding follow-up notes, sharing documents, and monitoring conversions from a secure admin dashboard and customer-facing portal.

## Features

- **Public Contact Form**: Landing page that captures inquiry details and submits them as new leads.
- **Customer Portal**: Dedicated user login/register flow for customers to track their consultation requests, statuses, shared files, and staff replies.
- **Team Dashboard**: Secure dashboard for staff to view and filter leads, update lead workflow statuses, assign team members, and follow up.
- **Role-Based Access Control**: Four granular roles:
  - `admin`: Full administrative access (create/manage team, delete files/notes, assign leads, update statuses, respond).
  - `manager`: High-level operations (assign leads, update statuses, view leads, respond).
  - `sales`: Client-level operations (view only assigned leads, update status, respond).
  - `customer`: Portal access (register, submit requests, view/download own requests and shared files).
- **Communication Thread & Files**:
  - **Shared Files & Documents**: Attach files (PDFs, images, code files, etc.) directly to lead threads. Customers are secured and only allowed to view/download files on their own leads.
  - **Visual Badges**: Interactive, color-coded badges (`Team` vs `Customer`) immediately identify who uploaded a document or posted a reply.
  - **Secure Delete Functions**: A `🗑️ Delete` capability next to files and notes. Enforces strict uploader and administrator authorization (team-uploaded files can only be deleted by their uploader or an admin; customer-uploaded files can *only* be deleted by the customer themselves).
- **Local Email Outbox**: Queues email notifications in a persistent SQLite table (`email_outbox`) for new requests, team assignments, status changes, and new replies.

## Tech Stack

- **Frontend**: Vanilla HTML5 (semantic elements), custom responsive CSS (with variables and smooth micro-animations), and modern JavaScript.
- **Backend**: Node.js HTTP server.
- **Database**: SQLite3 (persistent local database stored in `data/database.sqlite`), operated using robust promises.
- **File Uploads**: Managed locally via the `formidable` parsing library.

## Project Structure

```text
.
├── data/
│   ├── database.sqlite   # SQLite persistent database file
│   └── uploads/          # Physical file uploads storage directory
├── public/
│   ├── admin.html        # Team dashboard template
│   ├── admin.js          # Team dashboard logic
│   ├── index.html        # Main landing page & contact form
│   ├── lead-form.js      # Public form submission logic
│   ├── portal.html       # Customer portal interface
│   ├── portal.js         # Customer portal logic
│   └── styles.css        # Shared premium design CSS stylesheet
├── package.json          # Node dependencies & launch scripts
├── README.md             # Project documentation (this file)
└── server.js             # Consolidated Node backend server
```

## Setup & Running

1. Install Node.js (version 18 or newer).
2. Open the project folder in your terminal.
3. Install the dependencies (if you haven't already):
   ```bash
   npm install
   ```
4. Start the server:
   ```bash
   npm run dev
   ```
5. Open your browser and navigate to:
   ```text
   http://localhost:3000
   ```

## Default Accounts (Seeded Data)

```text
Admin:   admin@crm.local   / admin123
Manager: manager@crm.local / manager123
Sales:   sales@crm.local   / sales123
```

- **Customers** register or sign in at: `http://localhost:3000/portal`
- **Team members** log in at: `http://localhost:3000/admin`

*Note: You can override the seeded admin credentials by setting environment variables before the database is initialized:*
```bash
ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD=change-me npm run dev
```

## API Endpoint Reference

### Public & Authentication
- `POST /api/login` - Authenticate users (team & customers) and issue HttpOnly session cookies.
- `POST /api/register` - Customer registration.
- `POST /api/logout` - Clear cookies and terminate session.
- `GET /api/me` - Retrieve current logged-in user profile.
- `POST /api/public/leads` - Public landing page form submission.

### Team / Operations (Granular Access)
- `GET /api/users` - List CRM team users (admin only).
- `POST /api/users` - Create a team user (admin only).
- `GET /api/team/sales` - Fetch sales users for assignment (admin/manager only).
- `GET /api/leads` - List all leads (admins/managers) or assigned leads (sales).
- `GET /api/customer/leads` - Retrieve consultation requests for the logged-in customer.
- `PATCH /api/leads/:id` - Update a lead's status (`new` -> `contacted` -> `converted`).
- `PATCH /api/leads/:id/assign` - Assign a lead to a sales representative (admin/manager only).

### Communication & Notes
- `POST /api/leads/:id/notes` - Add a reply/note to a lead's communication history.
- `DELETE /api/leads/:id/notes/:noteId` - Delete a reply/note (restricted to creator or admin).

### File Management
- `POST /api/leads/:id/files` - Upload files/documents to a lead thread.
- `GET /api/leads/:leadId/files/:fileId` - Securely download shared files (customers can only access files linked to their own leads).
- `DELETE /api/leads/:leadId/files/:fileId` - Delete shared files (team-uploaded files can be deleted by their uploader/admin; customer-uploaded files are strictly deletable only by the customer).
