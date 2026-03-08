const express    = require("express");
const cors       = require("cors");
const fetch      = require("node-fetch");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const path       = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const app        = express();
const PORT       = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "betplay_secret_2026";
const API_KEY    = process.env.FOOTBALL_API_KEY || "afa24abadf594ebb9791a4e7154caf6f";
const API_BASE   = "https://api.football-data.org/v4";
const MONGO_URI  = process.env.MONGODB_URI || "mongodb+srv://BetPlay:eekk1104@betplay.sig2icr.mongodb.net/BetPlay?appName=BetPlay";

app.use(cors());
app.use(express.json());

// ── MongoDB ───────────────────────────────────────────────────────────────────
let db;
async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db("BetPlay");
  console.log("Connected to MongoDB");
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("bets").createIndex({ userId: 1 });
  await db.collection("bets").createIndex({ fixtureId: 1, status: 1 });
}

function auth(req, res, next) {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ error: "Invalid token" }); }
}

// ── Football API cache ────────────────────────────────────────────────────────
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
  { code:"PL",  name:"Premier League",   country:"England", color:"#3b82f6" },
  { code:"CL",  name:"Champions League", country:"Europe",  color:"#fbbf24" },
  { code:"PD",  name:"La Liga",          country:"Spain",   color:"#ef4444" },
  { code:"BL1", name:"Bundesliga",       country:"Germany", color:"#f59e0b" },
  { code:"SA",  name:"Serie A",          country:"Italy",   color:"#10b981" },
  { code:"FL1", name:"Ligue 1",          country:"France",  color:"#8b5cf6" },
];

// Generate realistic odds based on team league position
// football-data.org includes position in some responses but not fixtures list
// We use team ID to seed a deterministic "strength" so odds are consistent
function generateOdds(homeId, awayId, elapsed, homeScore, awayScore) {
  // Seed strength from team ID (0.0 - 1.0)
  const hStr = ((homeId * 7 + 13) % 100) / 100;
  const aStr = ((awayId * 11 + 7) % 100) / 100;

  // Home advantage bonus
  const hAdj = hStr * 0.6 + 0.2; // 0.2 - 0.8
  const aAdj = aStr * 0.6 + 0.1; // 0.1 - 0.7

  // Base odds (higher strength = lower odds = more favoured)
  let hOdds = Math.max(1.20, +(4.5 - hAdj * 3.5).toFixed(2));
  let aOdds = Math.max(1.30, +(5.0 - aAdj * 3.5).toFixed(2));
  let dOdds = +(2.5 + Math.abs(hAdj - aAdj) * 0.8).toFixed(2);

  // If live: adjust odds based on current score
  if (elapsed != null && homeScore != null && awayScore != null) {
    const diff = homeScore - awayScore;
    const timeLeft = Math.max(1, 90 - elapsed);
    const urgency = 90 / (timeLeft + 10); // increases as game nears end

    if (diff > 0) {
      // Home winning - home odds shorten, away lengthen
      hOdds = Math.max(1.05, +(hOdds - diff * 0.4 * urgency).toFixed(2));
      aOdds = Math.min(15.0, +(aOdds + diff * 0.6 * urgency).toFixed(2));
      dOdds = Math.min(10.0, +(dOdds + diff * 0.3 * urgency).toFixed(2));
    } else if (diff < 0) {
      aOdds = Math.max(1.05, +(aOdds + diff * 0.4 * urgency).toFixed(2));
      hOdds = Math.min(15.0, +(hOdds - diff * 0.6 * urgency).toFixed(2));
      dOdds = Math.min(10.0, +(dOdds - diff * 0.3 * urgency).toFixed(2));
    }
  }

  return { homeOdds: hOdds, drawOdds: dOdds, awayOdds: aOdds };
}

function parseMatch(m, comp) {
  const ss = m.status;
  let status = "upcoming";
  if (["IN_PLAY","PAUSED","LIVE"].includes(ss)) status = "live";
  else if (["FINISHED","AWARDED"].includes(ss))  status = "finished";

  const ko = new Date(m.utcDate);
  const timeStr = ko.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" })
    + " " + ko.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });

  const ft = m.score && m.score.fullTime;
  const ht = m.score && m.score.halfTime;
  const homeScore = status==="finished" ? (ft && ft.home != null ? ft.home : null)
    : status==="live" ? (ft && ft.home != null ? ft.home : (ht && ht.home != null ? ht.home : null)) : null;
  const awayScore = status==="finished" ? (ft && ft.away != null ? ft.away : null)
    : status==="live" ? (ft && ft.away != null ? ft.away : (ht && ht.away != null ? ht.away : null)) : null;

  const homeId = (m.homeTeam && m.homeTeam.id) || 1;
  const awayId = (m.awayTeam && m.awayTeam.id) || 2;
  const elapsed = m.minute || null;
  const odds = generateOdds(homeId, awayId, status === "live" ? elapsed : null, homeScore, awayScore);

  return {
    id: m.id, fixtureId: m.id,
    league: comp.name, leagueId: comp.code,
    leagueColor: comp.color, leagueCountry: comp.country,
    leagueLogo: "https://crests.football-data.org/" + (m.competition && m.competition.id) + ".png",
    home: (m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || "TBA",
    away: (m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || "TBA",
    homeTeamId: homeId, awayTeamId: awayId,
    homeLogo: (m.homeTeam && m.homeTeam.crest) || null,
    awayLogo: (m.awayTeam && m.awayTeam.crest) || null,
    time: timeStr, kickoffTs: ko.getTime(),
    status, elapsed,
    homeScore, awayScore,
    homeOdds: odds.homeOdds, drawOdds: odds.drawOdds, awayOdds: odds.awayOdds,
    winner: (m.score && m.score.winner) || null,
  };
}

// ── Bet settlement ────────────────────────────────────────────────────────────
async function settleBets() {
  const pending = await db.collection("bets").find({ status: "pending" }).toArray();
  if (!pending.length) return;

  const ids = [...new Set(pending.map(b => b.fixtureId))];
  for (const fid of ids) {
    let raw;
    try { raw = await footballFetch("/matches/" + fid, 0); }
    catch(e) { console.warn("Settlement fetch failed", fid, e.message); continue; }

    const m = (raw.id ? raw : raw.match) || raw;
    if (!["FINISHED","AWARDED"].includes(m.status)) continue;

    const ft = m.score && m.score.fullTime;
    if (!ft || ft.home == null || ft.away == null) continue;

    const homeG = ft.home, awayG = ft.away, total = homeG + awayG;
    const winner   = m.score.winner;
    const scoreStr = homeG + "-" + awayG;
    const htScore  = m.score && m.score.halfTime;
    const homeName = ((m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || "").toLowerCase();
    const awayName = ((m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || "").toLowerCase();

    const betsHere = pending.filter(b => String(b.fixtureId) === String(fid));
    for (const bet of betsHere) {
      const opt = (bet.option_label || "").toLowerCase();
      let won = false, refund = false;

      switch(bet.market) {
        case "Match Result":
          if (winner === "HOME_TEAM") won = opt.includes(homeName);
          else if (winner === "AWAY_TEAM") won = opt.includes(awayName);
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
          else if (winner === "DRAW") won = opt.includes("or");
          break;
        case "Half-Time Result":
          if (htScore && htScore.home != null) {
            const htW = htScore.home > htScore.away ? "HOME_TEAM" : htScore.away > htScore.home ? "AWAY_TEAM" : "DRAW";
            if (opt.includes("ht draw")) won = htW === "DRAW";
            else if (opt.includes(homeName)) won = htW === "HOME_TEAM";
            else if (opt.includes(awayName)) won = htW === "AWAY_TEAM";
          }
          break;
        case "Correct Score":
          won = opt === scoreStr;
          break;
        case "Total Cards":
        case "Total Corners":
        case "Anytime Scorer":
          refund = true;
          break;
      }

      const now = new Date().toISOString();
      if (refund) {
        await db.collection("bets").updateOne({ _id: bet._id }, { $set: { status: "refunded", settled_at: now } });
        await db.collection("users").updateOne({ _id: bet.userId }, { $inc: { balance: bet.amount } });
      } else {
        await db.collection("bets").updateOne({ _id: bet._id }, { $set: { status: won ? "won" : "lost", settled_at: now } });
        if (won) {
          await db.collection("users").updateOne({ _id: bet.userId }, { $inc: { balance: bet.potential } });
          console.log("PAYOUT", bet.potential, "->", bet.option_label);
        }
      }
    }
    await delay(200);
  }
}

setInterval(settleBets, 90000);
setTimeout(settleBets, 8000);

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });
    if (password.length < 4) return res.status(400).json({ error: "Password too short (min 4)" });
    const exists = await db.collection("users").findOne({ username });
    if (exists) return res.status(409).json({ error: "Username taken" });
    const hash = bcrypt.hashSync(password, 10);
    const user = { username, password: hash, balance: 100, joined: new Date().toISOString() };
    const result = await db.collection("users").insertOne(user);
    const id = result.insertedId.toString();
    const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: "90d" });
    res.json({ token, user: { id, username, balance: 100, joined: user.joined } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = await db.collection("users").findOne({ username });
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: "Invalid username or password" });
    const id = user._id.toString();
    const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: "90d" });
    res.json({ token, user: { id, username, balance: user.balance, joined: user.joined } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/me", auth, async (req, res) => {
  try {
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ error: "User not found" });
    const bets = await db.collection("bets").find({ userId: new ObjectId(req.user.id) }).toArray();
    const safeBets = bets.map(b => ({ ...b, id: b._id.toString(), userId: b.userId.toString() }));
    res.json({ id: req.user.id, username: user.username, balance: user.balance, joined: user.joined, bets: safeBets });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/bet", auth, async (req, res) => {
  try {
    const { fixtureId, matchLabel, league, leagueId, optionLabel, market, amount, odds, potential, matchTime } = req.body || {};
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (amount > user.balance) return res.status(400).json({ error: "Insufficient balance" });
    if (amount < 1) return res.status(400).json({ error: "Min bet $1" });
    const newBalance = Math.round((user.balance - amount) * 100) / 100;
    await db.collection("users").updateOne({ _id: user._id }, { $set: { balance: newBalance } });
    const bet = {
      userId: user._id, fixtureId, match_label: matchLabel, league, leagueId,
      option_label: optionLabel, market, amount, odds,
      potential: Math.round(potential * 100) / 100,
      match_time: matchTime, status: "pending", placed_at: new Date().toISOString()
    };
    const result = await db.collection("bets").insertOne(bet);
    const safeBet = { ...bet, id: result.insertedId.toString(), userId: req.user.id };
    setTimeout(settleBets, 3000);
    res.json({ bet: safeBet, balance: newBalance });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/adreward", auth, async (req, res) => {
  try {
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ error: "Not found" });
    const newBalance = Math.round((user.balance + 10) * 100) / 100;
    await db.collection("users").updateOne({ _id: user._id }, { $set: { balance: newBalance } });
    res.json({ balance: newBalance });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/leaderboard", auth, async (req, res) => {
  try {
    const users = await db.collection("users").find({}).toArray();
    const rows = await Promise.all(users.map(async u => {
      const bets = await db.collection("bets").find({ userId: u._id }).toArray();
      return { id: u._id.toString(), username: u.username, balance: u.balance, total_bets: bets.length, wins: bets.filter(b => b.status === "won").length };
    }));
    rows.sort((a, b) => b.balance - a.balance);
    res.json(rows.slice(0, 50));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Fixtures --
// Cache: non-live = 5 minutes, live = 30 seconds
// Only 6 leagues = 6 API calls max, well within 10 req/min free tier
let _fixturesCache = null;
let _fixturesCacheTs = 0;
let _fixturesRefreshing = false;

async function buildFixtures() {
  if (_fixturesRefreshing) return;
  _fixturesRefreshing = true;
  try {
    const from = new Date(); from.setDate(from.getDate() - 2);
    const to   = new Date(); to.setDate(to.getDate() + 7);
    const df = from.toISOString().split("T")[0];
    const dt = to.toISOString().split("T")[0];
    const all = [], seen = new Set();
    for (const comp of COMPETITIONS) {
      try {
        const res2 = await fetch(API_BASE + "/competitions/" + comp.code + "/matches?dateFrom=" + df + "&dateTo=" + dt, { headers: { "X-Auth-Token": API_KEY } });
        if (res2.status === 429) { console.warn("Rate limited on", comp.code); }
        else if (res2.ok) {
          const data = await res2.json();
          for (const m of (data.matches || [])) {
            if (!seen.has(m.id)) { all.push(parseMatch(m, comp)); seen.add(m.id); }
          }
        }
      } catch(e) { console.warn("Fetch failed", comp.code, e.message); }
      await delay(6200); // 6s between requests = safe under 10 req/min
    }
    all.sort((a, b) => {
      const ord = { live:0, upcoming:1, finished:2 };
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return a.kickoffTs - b.kickoffTs;
    });
    if (all.length > 0) { _fixturesCache = all; _fixturesCacheTs = Date.now(); }
    console.log("Fixtures built:", (_fixturesCache||[]).length, "matches");
  } catch(e) { console.error("buildFixtures error:", e.message); }
  finally { _fixturesRefreshing = false; }
}

// On boot, build immediately. Then check every 30s:
// - if any live match exists: rebuild every 30s
// - if no live matches: rebuild every 5 minutes
setTimeout(buildFixtures, 500);
setInterval(async function() {
  const hasLive = (_fixturesCache||[]).some(m => m.status === "live");
  const age = Date.now() - _fixturesCacheTs;
  const ttl = hasLive ? 30000 : 5 * 60 * 1000;
  if (age > ttl) buildFixtures();
}, 30000);

app.get("/api/fixtures", auth, (req, res) => {
  if (!_fixturesCache) return res.json({ response: [], total: 0, loading: true });
  res.json({ response: _fixturesCache, total: _fixturesCache.length });
});

// ── Match detail ──────────────────────────────────────────────────────────────
app.get("/api/fixtures/:id/stats", auth, async (req, res) => {
  try {
    const raw = await footballFetch("/matches/" + req.params.id, 15000);
    const m   = (raw.id ? raw : raw.match) || raw;
    const ft  = m.score && m.score.fullTime;
    const ht  = m.score && m.score.halfTime;
    const events = (m.goals || []).map(g => ({
      type: "Goal",
      player: { name: (g.scorer && g.scorer.name) || "Unknown" },
      team:   { name: (g.team   && g.team.name)   || "" },
      time:   { elapsed: g.minute },
    }));
    const homeLineup    = (m.homeTeam && m.homeTeam.lineup)    || [];
    const awayLineup    = (m.awayTeam && m.awayTeam.lineup)    || [];
    const homeBench     = (m.homeTeam && m.homeTeam.bench)     || [];
    const awayBench     = (m.awayTeam && m.awayTeam.bench)     || [];
    const homeFormation = (m.homeTeam && m.homeTeam.formation) || null;
    const awayFormation = (m.awayTeam && m.awayTeam.formation) || null;
    res.json({
      events, fullTime: ft || null, halfTime: ht || null,
      status: m.status, elapsed: m.minute || null,
      winner: (m.score && m.score.winner) || null,
      homeTeam: (m.homeTeam && m.homeTeam.name) || "",
      awayTeam: (m.awayTeam && m.awayTeam.name) || "",
      referees: (m.referees || []).map(r => r.name).join(", "),
      venue: m.venue || "", attendance: m.attendance || null,
      lineups: {
        home: { formation: homeFormation, lineup: homeLineup, bench: homeBench },
        away: { formation: awayFormation, lineup: awayLineup, bench: awayBench },
      },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/settle", auth, async (req, res) => {
  await settleBets(); res.json({ ok: true });
});

app.get("/api/test", async (req, res) => {
  try {
    const data = await footballFetch("/competitions/PL/matches?status=SCHEDULED", 0);
    res.json({ ok: true, scheduled: data.matches && data.matches.length, db: !!db });
  } catch(e) { res.json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, "build")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "build", "index.html")));

connectDB().then(() => {
  app.listen(PORT, () => console.log("BetPlay on port " + PORT));
}).catch(e => { console.error("Failed to connect to MongoDB:", e.message); process.exit(1); });
