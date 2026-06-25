# ☕ Bahr Coffee Store — POS System

A full-stack Point-of-Sale system built with **Node.js + Express + SQLite**.

## Stack

| Layer    | Technology |
|----------|-----------|
| Server   | Node.js + Express |
| Database | SQLite via sql.js (pure JS, no build tools) |
| Frontend | HTML + CSS + Vanilla JS |

---

## Run Locally

```bash
npm install
npm start
# open http://localhost:3000
```

---

## Deploy on Render (free)

### 1 — Create a Render account
Go to **render.com** and sign up (free).

### 2 — New Web Service
Dashboard → **New +** → **Web Service** → Connect GitHub → Select **Bahr-Coffee-Store**

### 3 — Settings (Render auto-detects render.yaml)

| Setting | Value |
|---------|-------|
| Build Command | `npm install` |
| Start Command | `npm start` |
| Plan | Free |

### 4 — Add Persistent Disk
- **Mount path:** `/var/data`
- **Size:** 1 GB

### 5 — Add Environment Variable
```
DB_PATH = /var/data/bahr_coffee.db
```

### 6 — Deploy
Your app will be live at `https://bahr-coffee-pos.onrender.com`

> Free tier sleeps after 15 min of inactivity (~30s cold start).

---

## Project Structure

```
├── server.js
├── render.yaml
├── src/
│   ├── db/database.js
│   └── routes/
│       ├── catalog.js
│       ├── customers.js
│       ├── orders.js
│       └── stats.js
└── public/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── db.js
        ├── catalog.js
        └── app.js
```
