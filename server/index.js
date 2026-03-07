const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "betplay_secret_2026";
const API_KEY = process.env.FOOTBALL_API_KEY || "PASTE_YOUR_KEY_HERE";
const API_BASE = "https://api.football-data.org/v4";

const adapter = new FileSync(path.join(__dirname, "db.json"));
const db = low(adapter);
db.defaults({ users: [], bets: [], nextUserId: 1, nextBetId: 1 }).write();

function getUser(id)      { return db.get("users").find({ id }).value(); }
function getUserByName(u) { return db.get("users").find({ username: u }).value(); }
function nextId(key)      { const id = db.get(key).value(); db.set(key, id + 1).write(); return id; }

app.use(cors());
app.use(express.json());

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Invalid token" }); }
}

// ─── API CACHE ────────────────────────────────────────────────────────────────
const cache = new Map();
async function footballFetch(urlPath, ttl = 30000) {
  const cached = cache.get(urlPath);
  if (cached && Date.now() - cached.ts < ttl) return cached.data;
  const res = await fetch(`${API_BASE}${urlPath}`, {
    headers: {
      "x-rapidapi-key": API_KEY,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(JSON.stringify(data.errors));
  }
  cache.set(urlPath, { data, ts: Date.now() });
  return data;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  if (password.length < 4) return res.status(400).json({ error: "Password too short" });
  if (getUserByName(username)) return res.status(409).json({ error: "Username already taken" });
  const id = nextId("nextUserId");
  const user = { id, username, password: bcrypt.hashSync(password, 10), balance: 100, joined: new Date().toISOString() };
  db.get("users").push(user).write();
  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: "30d" });
  const { password: _, ...safe } = user;
  res.json({ token, user: safe });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const user = getUserByName(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: "Invalid username or password" });
  const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: "30d" });
  const { password: _, ...safe } = user;
  res.json({ token, user: safe });
});

// ─── USER ─────────────────────────────────────────────────────────────────────
app.get("/api/me", auth, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  const bets = db.get("bets").filter({ userId: req.user.id }).value();
  const { password: _, ...safe } = user;
  res.json({ ...safe, bets });
});

app.post("/api/bet", auth, (req, res) => {
  const { fixtureId, matchLabel, league, leagueId, optionLabel, market, amount, odds, potential, matchTime } = req.body;
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (amount > user.balance) return res.status(400).json({ error: "Insufficient balance" });
  if (amount < 1) return res.status(400).json({ error: "Minimum bet is $1" });
  const newBalance = Math.round((user.balance - amount) * 100) / 100;
  db.get("users").find({ id: req.user.id }).assign({ balance: newBalance }).write();
  const bet = {
    id: nextId("nextBetId"), userId: req.user.id,
    fixtureId, match_label: matchLabel, league, leagueId,
    option_label: optionLabel, market, amount, odds, potential,
    match_time: matchTime, status: "pending",
    placed_at: new Date().toISOString()
  };
  db.get("bets").push(bet).write();
  res.json({ bet, balance: newBalance });
});

app.post("/api/adreward", auth, (req, res) => {
  const user = getUser(req.user.id);
  const newBalance = Math.round((user.balance + 10) * 100) / 100;
  db.get("users").find({ id: req.user.id }).assign({ balance: newBalance }).write();
  res.json({ balance: newBalance });
});

app.get("/api/leaderboard", auth, (req, res) => {
  const users = db.get("users").value().map(u => {
    const bets = db.get("bets").filter({ userId: u.id }).value();
    return { id: u.id, username: u.username, balance: u.balance, total_bets: bets.length, wins: bets.filter(b => b.status === "won").length };
  }).sort((a, b) => b.balance - a.balance).slice(0, 50);
  res.json(users);
});

// ─── FOOTBALL ────────────────────────────────────────────────────────────────
// Fetch ALL currently active leagues, then get fixtures for each
app.get("/api/fixtures", auth, async (req, res) => {
  try {
    // Step 1: get live matches immediately
    const liveData = await footballFetch("/fixtures?live=all");
    const liveFixtures = liveData.response || [];
    const seen = new Set(liveFixtures.map(f => f.fixture.id));

    // Step 2: get all current leagues (cached for 6 hours)
    const leaguesData = await footballFetch("/leagues?current=true", 6 * 60 * 60 * 1000);
    const leagues = (leaguesData.response || [])
      .filter(l => l.league.type === "League" || l.league.type === "Cup")
      .map(l => ({ id: l.league.id, season: l.seasons?.find(s => s.current)?.year || 2024 }));

    // Step 3: fetch next+last fixtures for each league in batches
    const BATCH = 10;
    const allFixtures = [...liveFixtures];

    for (let i = 0; i < leagues.length; i += BATCH) {
      const batch = leagues.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.flatMap(l => [
          footballFetch(`/fixtures?league=${l.id}&season=${l.season}&next=10`),
          footballFetch(`/fixtures?league=${l.id}&season=${l.season}&last=5`),
        ])
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          for (const f of (r.value.response || [])) {
            if (!seen.has(f.fixture.id)) {
              allFixtures.push(f);
              seen.add(f.fixture.id);
            }
          }
        }
      }
    }

    // Sort: live first, then upcoming by time, finished last
    allFixtures.sort((a, b) => {
      const ss = x => {
        const s = x.fixture?.status?.short;
        if (["1H","HT","2H","ET","BT","P","LIVE","INT"].includes(s)) return 0;
        if (["FT","AET","PEN"].includes(s)) return 2;
        return 1;
      };
      const sa = ss(a), sb = ss(b);
      if (sa !== sb) return sa - sb;
      return new Date(a.fixture.date) - new Date(b.fixture.date);
    });

    res.json({ response: allFixtures, total: allFixtures.length, liveCount: liveFixtures.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/fixtures/:id/lineups", auth, async (req, res) => {
  try { res.json(await footballFetch(`/fixtures/lineups?fixture=${req.params.id}`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/fixtures/:id/stats", auth, async (req, res) => {
  try {
    const [stats, events] = await Promise.all([
      footballFetch(`/fixtures/statistics?fixture=${req.params.id}`),
      footballFetch(`/fixtures/events?fixture=${req.params.id}`),
    ]);
    res.json({ stats: stats.response, events: events.response });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/test", async (req, res) => {
  try {
    const live = await footballFetch("/fixtures?live=all");
    const leagues = await footballFetch("/leagues?current=true");
    res.json({ liveCount: live.response?.length, totalLeagues: leagues.response?.length, errors: live.errors });
  } catch(e) { res.json({ error: e.message }); }
});

// STATIC FILES - must be last
app.use(express.static(path.join(__dirname, "build")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "build", "index.html")));

app.listen(PORT, () => console.log(`✅ BetPlay running on port ${PORT}`));
