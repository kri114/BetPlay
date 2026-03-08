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

// ─── DATABASE ─────────────────────────────────────────────────────────────────
// Render free tier: filesystem is ephemeral (wiped on deploy).
// To keep accounts alive across deploys, add a Render Persistent Disk mounted at /data
// and set env var DB_PATH=/data/betplay_db.json
// Without the disk, accounts reset on each deploy — this is a Render limitation.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "db.json");
const adapter = new FileSync(DB_PATH);
const db = low(adapter);
db.defaults({ users: [], bets: [], nextUserId: 1, nextBetId: 1 }).write();
console.log("DB at:", DB_PATH);

function getUser(id)      { return db.get("users").find({ id }).value(); }
function getUserByName(u) { return db.get("users").find({ username: u }).value(); }
function nextId(key)      { const id = db.get(key).value(); db.set(key, id + 1).write(); return id; }

app.use(cors());
app.use(express.json());

function auth(req, res, next) {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ error: "Invalid token" }); }
}

// ─── FOOTBALL API CACHE ───────────────────────────────────────────────────────
const cache = new Map();
async function footballFetch(urlPath, ttlMs) {
  if (ttlMs === undefined) ttlMs = 30000;
  if (ttlMs > 0) {
    const cached = cache.get(urlPath);
    if (cached && Date.now() - cached.ts < ttlMs) return cached.data;
  }
  const res = await fetch(API_BASE + urlPath, { headers: { "X-Auth-Token": API_KEY } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("API " + res.status + ": " + txt.slice(0, 200));
  }
  const data = await res.json();
  cache.set(urlPath, { data, ts: Date.now() });
  return data;
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

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
  else if (["FINISHED","AWARDED"].includes(ss)) status = "finished";

  const ko = new Date(m.utcDate);
  const timeStr = ko.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" })
    + " " + ko.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });

  const ft = m.score && m.score.fullTime;
  const ht = m.score && m.score.halfTime;

  const homeScore = status === "finished" ? (ft && ft.home != null ? ft.home : null)
    : status === "live" ? (ft && ft.home != null ? ft.home : (ht && ht.home != null ? ht.home : null))
    : null;
  const awayScore = status === "finished" ? (ft && ft.away != null ? ft.away : null)
    : status === "live" ? (ft && ft.away != null ? ft.away : (ht && ht.away != null ? ht.away : null))
    : null;

  return {
    id: m.id, fixtureId: m.id,
    league: comp.name, leagueId: comp.code,
    leagueColor: comp.color, leagueCountry: comp.country,
    leagueLogo: "https://crests.football-data.org/" + (m.competition && m.competition.id) + ".png",
    home: (m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || "TBA",
    away: (m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || "TBA",
    homeTeamName: (m.homeTeam && m.homeTeam.name) || "",
    awayTeamName: (m.awayTeam && m.awayTeam.name) || "",
    homeLogo: (m.homeTeam && m.homeTeam.crest) || null,
    awayLogo: (m.awayTeam && m.awayTeam.crest) || null,
    time: timeStr, kickoffTs: ko.getTime(),
    status, elapsed: m.minute || null,
    homeScore, awayScore,
    homeOdds: 2.50, drawOdds: 3.20, awayOdds: 2.80,
    winner: m.score && m.score.winner || null,
  };
}

// ─── BET SETTLEMENT ───────────────────────────────────────────────────────────
async function settleBets() {
  const pending = db.get("bets").filter({ status: "pending" }).value();
  if (!pending.length) return;

  const ids = [...new Set(pending.map(b => b.fixtureId))];
  for (const fid of ids) {
    let raw;
    try {
      // bypass cache for settlement — always fresh
      raw = await footballFetch("/matches/" + fid, 0);
    } catch(e) {
      console.warn("Settlement fetch failed for", fid, e.message);
      continue;
    }

    // football-data.org returns the match object directly (not wrapped)
    const m = raw.match || raw; // handle both {match:{...}} and direct object
    if (!["FINISHED","AWARDED"].includes(m.status)) continue;

    const ft = m.score && m.score.fullTime;
    if (!ft || ft.home == null || ft.away == null) continue;

    const homeG = ft.home, awayG = ft.away, total = homeG + awayG;
    const winner = m.score.winner;
    const scoreStr = homeG + "-" + awayG;
    const htScore = m.score && m.score.halfTime;

    const homeName = (m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name || "")).toLowerCase();
    const awayName = (m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name || "")).toLowerCase();

    const betsHere = pending.filter(b => String(b.fixtureId) === String(fid));
    for (const bet of betsHere) {
      const opt = (bet.option_label || "").toLowerCase();
      let won = false;

      switch(bet.market) {
        case "Match Result":
          if (winner === "HOME_TEAM") won = opt.includes(homeName) || opt === "home win";
          else if (winner === "AWAY_TEAM") won = opt.includes(awayName) || opt === "away win";
          else if (winner === "DRAW") won = opt === "draw";
          break;
        case "Both Teams to Score":
          const btts = homeG > 0 && awayG > 0;
          won = (opt.includes("yes") && btts) || (opt.includes("no") && !btts);
          break;
        case "Over / Under 1.5 Goals":
          won = (opt.startsWith("over") && total > 1) || (opt.startsWith("under") && total <= 1);
          break;
        case "Over / Under 2.5 Goals":
          won = (opt.startsWith("over") && total > 2) || (opt.startsWith("under") && total <= 2);
          break;
        case "Over / Under 3.5 Goals":
          won = (opt.startsWith("over") && total > 3) || (opt.startsWith("under") && total <= 3);
          break;
        case "Double Chance":
          if (winner === "HOME_TEAM") won = opt.includes(homeName) || (opt.includes("or") && !opt.includes(awayName));
          else if (winner === "AWAY_TEAM") won = opt.includes(awayName) || (opt.includes("or") && !opt.includes(homeName));
          else if (winner === "DRAW") won = opt.includes("or"); // any double chance covers a draw
          break;
        case "Half-Time Result":
          if (htScore && htScore.home != null) {
            const htW = htScore.home > htScore.away ? "HOME_TEAM" : htScore.away > htScore.home ? "AWAY_TEAM" : "DRAW";
            if (opt.includes("ht draw") || opt === "ht draw") won = htW === "DRAW";
            else if (opt.includes(homeName)) won = htW === "HOME_TEAM";
            else if (opt.includes(awayName)) won = htW === "AWAY_TEAM";
          }
          break;
        case "Correct Score":
          won = opt === scoreStr;
          break;
        // Cards/corners: refund (no data available on free tier)
        case "Total Cards":
        case "Total Corners":
        case "Anytime Scorer":
          // mark as refunded — give back the stake
          db.get("bets").find({ id: bet.id }).assign({ status: "refunded", settled_at: new Date().toISOString() }).write();
          const userR = getUser(bet.userId);
          if (userR) {
            const rb = Math.round((userR.balance + bet.amount) * 100) / 100;
            db.get("users").find({ id: bet.userId }).assign({ balance: rb }).write();
            console.log("Refunded", bet.amount, "to", userR.username, "- no data for market:", bet.market);
          }
          continue;
      }

      db.get("bets").find({ id: bet.id }).assign({ status: won ? "won" : "lost", settled_at: new Date().toISOString() }).write();
      if (won) {
        const payout = Math.round(bet.potential * 100) / 100;
        const u = getUser(bet.userId);
        if (u) {
          const nb = Math.round((u.balance + payout) * 100) / 100;
          db.get("users").find({ id: bet.userId }).assign({ balance: nb }).write();
          console.log("PAYOUT", payout, "->", u.username, "for", bet.market, bet.option_label);
        }
      }
    }
    await delay(200); // rate limit
  }
}

setInterval(settleBets, 90 * 1000); // every 90s
setTimeout(settleBets, 5000);        // once at boot

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  if (password.length < 4) return res.status(400).json({ error: "Password too short (min 4)" });
  if (getUserByName(username)) return res.status(409).json({ error: "Username taken" });
  const id = nextId("nextUserId");
  const hash = bcrypt.hashSync(password, 10);
  const user = { id, username, password: hash, balance: 100, joined: new Date().toISOString() };
  db.get("users").push(user).write();
  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: "90d" });
  const { password: _, ...safe } = user;
  res.json({ token, user: safe });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = getUserByName(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: "Invalid username or password" });
  const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: "90d" });
  const { password: _, ...safe } = user;
  res.json({ token, user: safe });
});

app.get("/api/me", auth, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const bets = db.get("bets").filter({ userId: req.user.id }).value();
  const { password: _, ...safe } = user;
  res.json({ ...safe, bets });
});

app.post("/api/bet", auth, (req, res) => {
  const { fixtureId, matchLabel, league, leagueId, optionLabel, market, amount, odds, potential, matchTime } = req.body || {};
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (amount > user.balance) return res.status(400).json({ error: "Insufficient balance" });
  if (amount < 1) return res.status(400).json({ error: "Min bet $1" });
  const newBalance = Math.round((user.balance - amount) * 100) / 100;
  db.get("users").find({ id: req.user.id }).assign({ balance: newBalance }).write();
  const bet = {
    id: nextId("nextBetId"), userId: req.user.id,
    fixtureId, match_label: matchLabel, league, leagueId,
    option_label: optionLabel, market, amount, odds, potential,
    match_time: matchTime, status: "pending", placed_at: new Date().toISOString()
  };
  db.get("bets").push(bet).write();
  // Try to settle immediately in case match is already finished
  setTimeout(settleBets, 2000);
  res.json({ bet, balance: newBalance });
});

app.post("/api/adreward", auth, (req, res) => {
  const user = getUser(req.user.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  const newBalance = Math.round((user.balance + 10) * 100) / 100;
  db.get("users").find({ id: req.user.id }).assign({ balance: newBalance }).write();
  res.json({ balance: newBalance });
});

app.get("/api/leaderboard", auth, (req, res) => {
  const rows = db.get("users").value().map(u => {
    const bets = db.get("bets").filter({ userId: u.id }).value();
    return { id: u.id, username: u.username, balance: u.balance, total_bets: bets.length, wins: bets.filter(b => b.status === "won").length };
  }).sort((a, b) => b.balance - a.balance).slice(0, 50);
  res.json(rows);
});

// ─── FIXTURES ─────────────────────────────────────────────────────────────────
app.get("/api/fixtures", auth, async (req, res) => {
  try {
    const from = new Date(); from.setDate(from.getDate() - 2);
    const to   = new Date(); to.setDate(to.getDate() + 7);
    const df = from.toISOString().split("T")[0];
    const dt = to.toISOString().split("T")[0];

    const all = [], seen = new Set();

    for (const comp of COMPETITIONS) {
      try {
        // Use short TTL so live scores refresh quickly
        const data = await footballFetch("/competitions/" + comp.code + "/matches?dateFrom=" + df + "&dateTo=" + dt, 20000);
        for (const m of (data.matches || [])) {
          if (!seen.has(m.id)) { all.push(parseMatch(m, comp)); seen.add(m.id); }
        }
      } catch(e) { console.warn("Fetch failed", comp.code, e.message); }
      await delay(110); // stay under 10 req/min free limit
    }

    all.sort((a, b) => {
      const ord = { live:0, upcoming:1, finished:2 };
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return a.kickoffTs - b.kickoffTs;
    });

    res.json({ response: all, total: all.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── MATCH DETAIL ─────────────────────────────────────────────────────────────
// football-data.org /matches/:id returns the match with homeTeam.lineup[] on the free tier
app.get("/api/fixtures/:id/stats", auth, async (req, res) => {
  try {
    const raw = await footballFetch("/matches/" + req.params.id, 15000);
    // API returns match directly OR wrapped in { match: {...} }
    const m = (raw.id ? raw : raw.match) || raw;

    const ft = m.score && m.score.fullTime;
    const ht = m.score && m.score.halfTime;

    // Goals (scorer events)
    const events = (m.goals || []).map(g => ({
      type: "Goal",
      player: { name: (g.scorer && g.scorer.name) || "Unknown" },
      team:   { name: (g.team   && g.team.name)   || "" },
      time:   { elapsed: g.minute },
    }));

    // Lineups — football-data.org free tier DOES include lineup arrays on the match object
    const homeLineup = (m.homeTeam && m.homeTeam.lineup) || [];
    const awayLineup = (m.awayTeam && m.awayTeam.lineup) || [];
    const homeBench  = (m.homeTeam && m.homeTeam.bench)  || [];
    const awayBench  = (m.awayTeam && m.awayTeam.bench)  || [];
    const homeFormation = (m.homeTeam && m.homeTeam.formation) || null;
    const awayFormation = (m.awayTeam && m.awayTeam.formation) || null;

    res.json({
      events,
      fullTime:      ft   || null,
      halfTime:      ht   || null,
      status:        m.status,
      winner:        (m.score && m.score.winner) || null,
      homeTeam:      (m.homeTeam && m.homeTeam.name) || "",
      awayTeam:      (m.awayTeam && m.awayTeam.name) || "",
      referees:      (m.referees || []).map(r => r.name).join(", "),
      venue:         m.venue || "",
      attendance:    m.attendance || null,
      lineups: {
        home: { formation: homeFormation, lineup: homeLineup, bench: homeBench },
        away: { formation: awayFormation, lineup: awayLineup, bench: awayBench },
      },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Manual settle trigger (for testing)
app.post("/api/settle", auth, async (req, res) => {
  await settleBets();
  res.json({ ok: true });
});

// Debug
app.get("/api/test", async (req, res) => {
  try {
    const live = await footballFetch("/competitions/PL/matches?status=IN_PLAY", 0);
    const sched = await footballFetch("/competitions/PL/matches?status=SCHEDULED", 0);
    res.json({ live: live.matches && live.matches.length, scheduled: sched.matches && sched.matches.length });
  } catch(e) { res.json({ error: e.message }); }
});

// ─── STATIC ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "build")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "build", "index.html")));

app.listen(PORT, () => console.log("BetPlay on port " + PORT + " | DB: " + DB_PATH));
