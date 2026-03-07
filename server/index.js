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
const API_KEY = process.env.FOOTBALL_API_KEY || "afa24abadf594ebb9791a4e7154caf6f";
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

const cache = new Map();
async function footballFetch(urlPath, ttl = 60000) {
  const cached = cache.get(urlPath);
  if (cached && Date.now() - cached.ts < ttl) return cached.data;
  const res = await fetch(`${API_BASE}${urlPath}`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API ${res.status}: ${txt.slice(0,120)}`);
  }
  const data = await res.json();
  cache.set(urlPath, { data, ts: Date.now() });
  return data;
}

const COMPETITIONS = [
  { code: "PL",  name: "Premier League",    country: "England",    color: "#3b82f6" },
  { code: "CL",  name: "Champions League",  country: "Europe",     color: "#fbbf24" },
  { code: "PD",  name: "La Liga",           country: "Spain",      color: "#ef4444" },
  { code: "BL1", name: "Bundesliga",        country: "Germany",    color: "#f59e0b" },
  { code: "SA",  name: "Serie A",           country: "Italy",      color: "#10b981" },
  { code: "FL1", name: "Ligue 1",           country: "France",     color: "#8b5cf6" },
  { code: "PPL", name: "Primeira Liga",     country: "Portugal",   color: "#22c55e" },
  { code: "ELC", name: "Championship",      country: "England",    color: "#60a5fa" },
  { code: "BSA", name: "Brasileirao",       country: "Brazil",     color: "#84cc16" },
  { code: "CLI", name: "Copa Libertadores", country: "S. America", color: "#f97316" },
];

function parseMatch(m, comp) {
  const ss = m.status;
  let status = "upcoming";
  if (["IN_PLAY","PAUSED","LIVE"].includes(ss)) status = "live";
  else if (ss === "FINISHED") status = "finished";

  const ko = new Date(m.utcDate);
  const timeStr = ko.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" }) +
    " · " + ko.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });

  const homeScore = status === "finished"
    ? (m.score?.fullTime?.home ?? null)
    : status === "live"
    ? (m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null)
    : null;
  const awayScore = status === "finished"
    ? (m.score?.fullTime?.away ?? null)
    : status === "live"
    ? (m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null)
    : null;

  return {
    id: m.id, fixtureId: m.id,
    league: comp.name, leagueId: comp.code,
    leagueColor: comp.color, leagueCountry: comp.country,
    leagueLogo: `https://crests.football-data.org/${m.competition?.id}.png`,
    home: m.homeTeam?.shortName || m.homeTeam?.name || "TBA",
    away: m.awayTeam?.shortName || m.awayTeam?.name || "TBA",
    homeLogo: m.homeTeam?.crest || null,
    awayLogo: m.awayTeam?.crest || null,
    time: timeStr, kickoffTs: ko.getTime(),
    status, elapsed: m.minute || null,
    homeScore, awayScore,
    homeOdds: 2.50, drawOdds: 3.20, awayOdds: 2.80,
  };
}

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
  const bet = { id: nextId("nextBetId"), userId: req.user.id, fixtureId, match_label: matchLabel, league, leagueId, option_label: optionLabel, market, amount, odds, potential, match_time: matchTime, status: "pending", placed_at: new Date().toISOString() };
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

app.get("/api/fixtures", auth, async (req, res) => {
  try {
    const from = new Date(); from.setDate(from.getDate() - 2);
    const to = new Date(); to.setDate(to.getDate() + 7);
    const dateFrom = from.toISOString().split("T")[0];
    const dateTo   = to.toISOString().split("T")[0];

    const all = [];
    const seen = new Set();

    for (const comp of COMPETITIONS) {
      try {
        const data = await footballFetch(
          `/competitions/${comp.code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`
        );
        for (const m of (data.matches || [])) {
          if (!seen.has(m.id)) {
            all.push(parseMatch(m, comp));
            seen.add(m.id);
          }
        }
      } catch(e) {
        console.warn(`Failed ${comp.code}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 200));
    }

    all.sort((a, b) => {
      const o = { live:0, upcoming:1, finished:2 };
      if (o[a.status] !== o[b.status]) return o[a.status] - o[b.status];
      return a.kickoffTs - b.kickoffTs;
    });

    res.json({ response: all, total: all.length, liveCount: all.filter(m=>m.status==="live").length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/fixtures/:id/lineups", auth, async (req, res) => {
  res.json({ response: [] });
});

app.get("/api/fixtures/:id/stats", auth, async (req, res) => {
  try {
    const data = await footballFetch(`/matches/${req.params.id}`);
    const events = (data.goals || []).map(g => ({
      type: "Goal",
      player: { name: g.scorer?.name || "Unknown" },
      team: { name: g.team?.name },
      time: { elapsed: g.minute },
    }));
    res.json({ stats: [], events });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/test", async (req, res) => {
  try {
    const data = await footballFetch("/competitions/PL/matches?status=SCHEDULED");
    const first = data.matches?.[0];
    res.json({
      status: "OK",
      matchCount: data.matches?.length,
      nextMatch: first ? `${first.homeTeam?.shortName} vs ${first.awayTeam?.shortName} on ${first.utcDate?.split("T")[0]}` : "none",
    });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, "build")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "build", "index.html")));

app.listen(PORT, () => console.log(`✅ BetPlay running on port ${PORT}`));
