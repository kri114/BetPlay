const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "betplay_secret_change_in_production";
const API_KEY = process.env.FOOTBALL_API_KEY || "7f5c79ac31344744a558c11a582c1bf7";
const API_BASE = "https://v3.football.api-sports.io";

// ─── DATABASE SETUP ───────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, "betplay.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    balance REAL DEFAULT 100.00,
    joined TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    fixture_id INTEGER,
    match_label TEXT,
    league TEXT,
    option_label TEXT,
    market TEXT,
    amount REAL,
    odds REAL,
    potential REAL,
    match_time TEXT,
    status TEXT DEFAULT 'pending',
    placed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve React build in production
app.use(express.static(path.join(__dirname, "../client/build")));

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ─── FOOTBALL API CACHE ───────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 30 * 1000; // 30 seconds for live data

async function footballFetch(path) {
  const cacheKey = path;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "x-rapidapi-key": API_KEY,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });

  if (!res.ok) throw new Error(`Football API error: ${res.status}`);
  const data = await res.json();
  cache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  if (password.length < 4) return res.status(400).json({ error: "Password too short" });

  const hashed = bcrypt.hashSync(password, 10);
  try {
    const stmt = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
    const result = stmt.run(username, hashed);
    const user = db.prepare("SELECT id, username, balance, joined FROM users WHERE id = ?").get(result.lastInsertRowid);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user });
  } catch (e) {
    if (e.message.includes("UNIQUE")) return res.status(409).json({ error: "Username already taken" });
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "30d" });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

// ─── USER ROUTES ──────────────────────────────────────────────────────────────
app.get("/api/me", authMiddleware, (req, res) => {
  const user = db.prepare("SELECT id, username, balance, joined FROM users WHERE id = ?").get(req.user.id);
  const bets = db.prepare("SELECT * FROM bets WHERE user_id = ? ORDER BY placed_at DESC").all(req.user.id);
  res.json({ ...user, bets });
});

app.post("/api/bet", authMiddleware, (req, res) => {
  const { fixtureId, matchLabel, league, optionLabel, market, amount, odds, potential, matchTime } = req.body;
  const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(req.user.id);

  if (!user) return res.status(404).json({ error: "User not found" });
  if (amount > user.balance) return res.status(400).json({ error: "Insufficient balance" });
  if (amount < 1) return res.status(400).json({ error: "Minimum bet is $1" });

  db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(amount, req.user.id);
  const bet = db.prepare(`
    INSERT INTO bets (user_id, fixture_id, match_label, league, option_label, market, amount, odds, potential, match_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, fixtureId, matchLabel, league, optionLabel, market, amount, odds, potential, matchTime);

  const newBalance = db.prepare("SELECT balance FROM users WHERE id = ?").get(req.user.id).balance;
  const newBet = db.prepare("SELECT * FROM bets WHERE id = ?").get(bet.lastInsertRowid);
  res.json({ bet: newBet, balance: newBalance });
});

app.post("/api/adreward", authMiddleware, (req, res) => {
  db.prepare("UPDATE users SET balance = balance + 10 WHERE id = ?").run(req.user.id);
  const { balance } = db.prepare("SELECT balance FROM users WHERE id = ?").get(req.user.id);
  res.json({ balance });
});

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
app.get("/api/leaderboard", authMiddleware, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.balance,
      COUNT(b.id) as total_bets,
      SUM(CASE WHEN b.status = 'won' THEN 1 ELSE 0 END) as wins
    FROM users u
    LEFT JOIN bets b ON b.user_id = u.id
    GROUP BY u.id
    ORDER BY u.balance DESC
    LIMIT 50
  `).all();
  res.json(users);
});

// ─── FOOTBALL API PROXY ROUTES ────────────────────────────────────────────────
const LEAGUES = [
  { id: 39,  name: "Premier League",   season: 2025 },
  { id: 140, name: "La Liga",          season: 2025 },
  { id: 78,  name: "Bundesliga",       season: 2025 },
  { id: 135, name: "Serie A",          season: 2025 },
  { id: 61,  name: "Ligue 1",          season: 2025 },
  { id: 2,   name: "Champions League", season: 2025 },
];

app.get("/api/fixtures", authMiddleware, async (req, res) => {
  try {
    const [liveData, ...leagueResults] = await Promise.all([
      footballFetch("/fixtures?live=all"),
      ...LEAGUES.map(l => footballFetch(`/fixtures?league=${l.id}&season=${l.season}&next=10`)),
    ]);

    const all = [];
    const seen = new Set();

    // Live first
    for (const f of (liveData.response || [])) {
      if (!seen.has(f.fixture.id)) { all.push(f); seen.add(f.fixture.id); }
    }
    // Upcoming per league
    for (const data of leagueResults) {
      for (const f of (data.response || [])) {
        if (!seen.has(f.fixture.id)) { all.push(f); seen.add(f.fixture.id); }
      }
    }

    res.json({ response: all });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/fixtures/:id/lineups", authMiddleware, async (req, res) => {
  try {
    const data = await footballFetch(`/fixtures/lineups?fixture=${req.params.id}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/fixtures/:id/stats", authMiddleware, async (req, res) => {
  try {
    const [stats, events] = await Promise.all([
      footballFetch(`/fixtures/statistics?fixture=${req.params.id}`),
      footballFetch(`/fixtures/events?fixture=${req.params.id}`),
    ]);
    res.json({ stats: stats.response, events: events.response });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CATCH-ALL for React ──────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build/index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ BetPlay server running on http://localhost:${PORT}`);
});
