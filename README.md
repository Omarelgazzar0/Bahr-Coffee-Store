# ☕ Fares Mansour Coffee — POS System

A full-stack Point-of-Sale system built with **Node.js + Express + SQLite**.

## Stack

| Layer    | Technology |
|----------|-----------|
| Server   | Node.js + Express |
| Database | SQLite via [sql.js](https://sql.js.org) (pure JS, no build tools) |
| Frontend | HTML + CSS + Vanilla JS |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
http://localhost:3000
```

> **Development mode** (auto-restarts on file changes):
> ```bash
> npm run dev
> ```

The database is created automatically at `data/fares_mansour.db` on first run.

## Project Structure

```
├── server.js               ← Express entry point
├── package.json
├── src/
│   ├── db/
│   │   └── database.js     ← SQLite layer (init, all, get, run, transaction)
│   └── routes/
│       ├── catalog.js      ← /api/catalog
│       ├── customers.js    ← /api/customers
│       ├── orders.js       ← /api/orders
│       └── stats.js        ← /api/stats
└── public/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── db.js           ← REST API client
        ├── catalog.js      ← Cart logic + POS grid
        └── app.js          ← UI controller & routing
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/catalog` | All items (`?active=true` for POS only) |
| POST | `/api/catalog` | Add item |
| PATCH | `/api/catalog/:id/toggle` | Archive / restore |
| DELETE | `/api/catalog/:id` | Delete item |
| GET | `/api/customers` | All customers + stats |
| GET | `/api/customers/:id` | Single customer |
| POST | `/api/orders` | Create order |
| GET | `/api/orders` | Order history |
| GET | `/api/orders/:id` | Single order + items |
| GET | `/api/stats` | Dashboard aggregates |

## Database Backup

```bash
cp data/fares_mansour.db data/backup_$(date +%Y%m%d).db
```

## Production

```bash
# With PM2
npm install -g pm2
pm2 start server.js --name fmc-pos
pm2 save && pm2 startup
```
