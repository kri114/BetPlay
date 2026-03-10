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
const API_KEY    = process.env.FOOTBALL_API_KEY || "d69b3f33f9037aaf01197bb92b1cd97843d9715ec09900ed6a7b49e856b4472e";
const API_BASE   = "https://apiv2.allsportsapi.com/football";
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

const delay = ms => new Promise(r => setTimeout(r, ms));

// AllSportsAPI league IDs
const LEAGUES = [
  { id: 148, name: "Premier League",   country: "England", color: "#3b82f6" },
  { id: 149, name: "Champions League", country: "Europe",  color: "#fbbf24" },
  { id: 150, name: "La Liga",          country: "Spain",   color: "#ef4444" },
  { id: 151, name: "Bundesliga",       country: "Germany", color: "#f59e0b" },
  { id: 207, name: "Serie A",          country: "Italy",   color: "#10b981" },
  { id: 168, name: "Ligue 1",          country: "France",  color: "#8b5cf6" },
];

// Deduplicated league list for fetching
const FETCH_LEAGUES = [
  { id: 148, name: "Premier League",   country: "England", color: "#3b82f6" },
  { id: 149, name: "Champions League", country: "Europe",  color: "#fbbf24" },
  { id: 150, name: "La Liga",          country: "Spain",   color: "#ef4444" },
  { id: 151, name: "Bundesliga",       country: "Germany", color: "#f59e0b" },
  { id: 207, name: "Serie A",          country: "Italy",   color: "#10b981" },
  { id: 168, name: "Ligue 1",          country: "France",  color: "#8b5cf6" },
];

const LEAGUE_MAP = {};
FETCH_LEAGUES.forEach(l => { LEAGUE_MAP[l.id] = l; });

// ── AllSportsAPI fetch ────────────────────────────────────────────────────────
async function apiFetch(params) {
  const qs = new URLSearchParams({ APIkey: API_KEY, ...params }).toString();
  const url = API_BASE + "/?" + qs;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API " + res.status);
  const data = await res.json();
  if (data.success === 0) throw new Error("API error: " + JSON.stringify(data));
  return data.result || [];
}

// ── Odds generator ────────────────────────────────────────────────────────────
function generateOdds(homeId, awayId, elapsed, homeScore, awayScore) {
  const hStr = ((homeId * 7 + 13) % 100) / 100;
  const aStr = ((awayId * 11 + 7) % 100) / 100;
  const hAdj = hStr * 0.6 + 0.2;
  const aAdj = aStr * 0.6 + 0.1;
  let hOdds = Math.max(1.20, +(4.5 - hAdj * 3.5).toFixed(2));
  let aOdds = Math.max(1.30, +(5.0 - aAdj * 3.5).toFixed(2));
  let dOdds = +(2.5 + Math.abs(hAdj - aAdj) * 0.8).toFixed(2);
  if (elapsed != null && homeScore != null && awayScore != null) {
    const diff = homeScore - awayScore;
    const urgency = 90 / (Math.max(1, 90 - elapsed) + 10);
    if (diff > 0) {
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

// ── Parse fixture from AllSportsAPI ──────────────────────────────────────────
function parseFixture(m, leagueInfo) {
  const ss = m.event_status || "";
  let status = "upcoming";
  if (ss === "Finished") status = "finished";
  else if (["1st Half", "2nd Half", "Half Time", "Extra Time", "Penalty In Progress", "Live"].includes(ss)) status = "live";

  const elapsed = parseInt(m.event_status_int) || null;
  const homeScore = m.event_final_result ? parseInt(m.event_final_result.split(" - ")[0]) : (status === "live" ? parseInt(m.event_home_current_score) || null : null);
  const awayScore = m.event_final_result ? parseInt(m.event_final_result.split(" - ")[1]) : (status === "live" ? parseInt(m.event_away_current_score) || null : null);

  const homeId = parseInt(m.home_team_key) || 1;
  const awayId = parseInt(m.away_team_key) || 2;
  const odds = generateOdds(homeId, awayId, status === "live" ? elapsed : null, homeScore, awayScore);

  const ko = new Date(m.event_date + "T" + (m.event_time || "00:00") + ":00");
  const timeStr = ko.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" })
    + " " + (m.event_time || "TBD");

  const lc = leagueInfo || { name: m.league_name || "Unknown", color: "#e8ff47", country: "" };

  return {
    id: m.event_key, fixtureId: m.event_key,
    league: lc.name, leagueId: String(lc.id || m.league_key),
    leagueColor: lc.color, leagueCountry: lc.country,
    leagueLogo: m.league_logo || null,
    home: m.event_home_team || "TBA",
    away: m.event_away_team || "TBA",
    homeLogo: m.home_team_logo || null,
    awayLogo: m.away_team_logo || null,
    time: timeStr, kickoffTs: ko.getTime(),
    status, elapsed: status === "live" ? elapsed : null,
    homeScore: homeScore != null ? homeScore : null,
    awayScore: awayScore != null ? awayScore : null,
    homeOdds: odds.homeOdds, drawOdds: odds.drawOdds, awayOdds: odds.awayOdds,
    winner: status === "finished" ? (homeScore > awayScore ? "HOME_TEAM" : awayScore > homeScore ? "AWAY_TEAM" : "DRAW") : null,
  };
}

// ── Fixtures cache ────────────────────────────────────────────────────────────
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
    for (const league of FETCH_LEAGUES) {
      try {
        const matches = await apiFetch({ met: "Fixtures", leagueId: league.id, from: df, to: dt });
        for (const m of matches) {
          if (!seen.has(m.event_key)) {
            all.push(parseFixture(m, league));
            seen.add(m.event_key);
          }
        }
        console.log("Fetched", league.name, "-", matches.length, "fixtures");
      } catch(e) { console.warn("Failed", league.name, e.message); }
      await delay(1000);
    }

    all.sort((a, b) => {
      const ord = { live:0, upcoming:1, finished:2 };
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return a.kickoffTs - b.kickoffTs;
    });

    if (all.length > 0) {
      _fixturesCache = all;
      _fixturesCacheTs = Date.now();
      console.log("Fixtures built:", all.length, "total,", all.filter(m => m.status === "live").length, "live");
    }
  } catch(e) { console.error("buildFixtures error:", e.message); }
  finally { _fixturesRefreshing = false; }
}

setTimeout(buildFixtures, 500);
setInterval(function() {
  const hasLive = (_fixturesCache || []).some(m => m.status === "live");
  const age = Date.now() - _fixturesCacheTs;
  const ttl = hasLive ? 60000 : 10 * 60 * 1000;
  if (age > ttl) buildFixtures();
}, 60000);

// ── Bet settlement ────────────────────────────────────────────────────────────
async function settleBets() {
  const pending = await db.collection("bets").find({ status: "pending" }).toArray();
  if (!pending.length) return;
  const ids = [...new Set(pending.map(b => b.fixtureId))];
  for (const fid of ids) {
    let matches;
    try { matches = await apiFetch({ met: "Fixtures", matchId: fid }); }
    catch(e) { console.warn("Settlement fetch failed", fid, e.message); continue; }
    const m = matches && matches[0];
    if (!m || m.event_status !== "Finished") continue;
    const result = m.event_final_result || "";
    const parts = result.split(" - ");
    if (parts.length < 2) continue;
    const homeG = parseInt(parts[0]);
    const awayG = parseInt(parts[1]);
    if (isNaN(homeG) || isNaN(awayG)) continue;
    const total = homeG + awayG;
    const winner = homeG > awayG ? "HOME_TEAM" : awayG > homeG ? "AWAY_TEAM" : "DRAW";
    const scoreStr = homeG + "-" + awayG;
    const homeName = (m.event_home_team || "").toLowerCase();
    const awayName = (m.event_away_team || "").toLowerCase();

    const betsHere = pending.filter(b => String(b.fixtureId) === String(fid));
    for (const bet of betsHere) {
      const opt = (bet.option_label || "").toLowerCase();
      let won = false, refund = false;
      switch(bet.market) {
        case "Match Result":
          if (winner === "HOME_TEAM") won = opt.includes(homeName);
          else if (winner === "AWAY_TEAM") won = opt.includes(awayName);
          else won = opt === "draw"; break;
        case "Both Teams to Score":
          won = (opt.includes("yes") && homeG > 0 && awayG > 0) || (opt.includes("no") && !(homeG > 0 && awayG > 0)); break;
        case "Over / Under 1.5 Goals":
          won = (opt.startsWith("over") && total > 1) || (opt.startsWith("under") && total <= 1); break;
        case "Over / Under 2.5 Goals":
          won = (opt.startsWith("over") && total > 2) || (opt.startsWith("under") && total <= 2); break;
        case "Over / Under 3.5 Goals":
          won = (opt.startsWith("over") && total > 3) || (opt.startsWith("under") && total <= 3); break;
        case "Double Chance":
          if (winner === "HOME_TEAM") won = opt.includes(homeName) || (opt.includes("or") && !opt.includes(awayName));
          else if (winner === "AWAY_TEAM") won = opt.includes(awayName) || (opt.includes("or") && !opt.includes(homeName));
          else won = opt.includes(" or "); break;
        case "Half-Time Result":
          refund = true; break;
        case "Correct Score":
          won = opt === scoreStr; break;
        case "Total Cards": case "Total Corners": case "Anytime Scorer":
          refund = true; break;
      }
      const now = new Date().toISOString();
      if (refund) {
        await db.collection("bets").updateOne({ _id: bet._id }, { $set: { status: "refunded", settled_at: now } });
        await db.collection("users").updateOne({ _id: bet.userId }, { $inc: { balance: bet.amount } });
      } else {
        await db.collection("bets").updateOne({ _id: bet._id }, { $set: { status: won ? "won" : "lost", settled_at: now } });
        if (won) await db.collection("users").updateOne({ _id: bet.userId }, { $inc: { balance: bet.potential } });
      }
    }
    await delay(500);
  }
}
setInterval(settleBets, 90000);
setTimeout(settleBets, 10000);

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });
    if (password.length < 4) return res.status(400).json({ error: "Password too short" });
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
      return res.status(401).json({ error: "Invalid credentials" });
    const id = user._id.toString();
    const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: "90d" });
    res.json({ token, user: { id, username, balance: user.balance, joined: user.joined } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/me", auth, async (req, res) => {
  try {
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ error: "Not found" });
    const bets = await db.collection("bets").find({ userId: new ObjectId(req.user.id) }).toArray();
    const safeBets = bets.map(b => ({ ...b, id: b._id.toString(), userId: b.userId.toString() }));
    res.json({ id: req.user.id, username: user.username, balance: user.balance, joined: user.joined, bets: safeBets });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/bet", auth, async (req, res) => {
  try {
    const { fixtureId, matchLabel, league, leagueId, optionLabel, market, amount, odds, potential, matchTime } = req.body || {};
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ error: "Not found" });
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

app.get("/api/fixtures", auth, (req, res) => {
  if (!_fixturesCache) return res.json({ response: [], total: 0, loading: true });
  res.json({ response: _fixturesCache, total: _fixturesCache.length });
});

// ── Match stats + lineups ─────────────────────────────────────────────────────
app.get("/api/fixtures/:id/stats", auth, async (req, res) => {
  try {
    const matches = await apiFetch({ met: "Fixtures", matchId: req.params.id });
    const m = matches && matches[0];
    if (!m) return res.status(404).json({ error: "Match not found" });

    const result = m.event_final_result || "";
    const parts = result.split(" - ");
    const homeG = parts[0] != null ? parseInt(parts[0]) : null;
    const awayG = parts[1] != null ? parseInt(parts[1]) : null;

    // Goals from lineups/events
    const goalEvents = [];
    if (m.goalscorers && Array.isArray(m.goalscorers)) {
      m.goalscorers.forEach(g => {
        goalEvents.push({
          type: "Goal",
          player: { name: g.home_scorer || g.away_scorer || "Unknown" },
          team:   { name: g.home_scorer ? m.event_home_team : m.event_away_team },
          time:   { elapsed: parseInt(g.time) || null },
        });
      });
    }

    // Lineups
    const hl = m.lineups && m.lineups.home_team;
    const al = m.lineups && m.lineups.away_team;

    const mapPlayer = p => ({ name: p.player || p.player_name || "", shirtNumber: p.player_number || null, position: p.player_position || null });

    const homeLineup = (hl && hl.starting_lineups || []).map(mapPlayer);
    const homeBench  = (hl && hl.substitutes      || []).map(mapPlayer);
    const awayLineup = (al && al.starting_lineups || []).map(mapPlayer);
    const awayBench  = (al && al.substitutes      || []).map(mapPlayer);

    const ss = m.event_status || "";
    let status = "upcoming";
    if (ss === "Finished") status = "finished";
    else if (["1st Half","2nd Half","Half Time","Extra Time","Live"].includes(ss)) status = "live";

    res.json({
      events: goalEvents,
      fullTime: homeG != null ? { home: homeG, away: awayG } : null,
      halfTime: m.event_halftime_result ? {
        home: parseInt((m.event_halftime_result || "").split(" - ")[0]),
        away: parseInt((m.event_halftime_result || "").split(" - ")[1]),
      } : null,
      status, elapsed: parseInt(m.event_status_int) || null,
      winner: homeG != null ? (homeG > awayG ? "HOME_TEAM" : awayG > homeG ? "AWAY_TEAM" : "DRAW") : null,
      homeTeam: m.event_home_team || "",
      awayTeam: m.event_away_team || "",
      referees: m.event_referee || "",
      venue: m.event_stadium || "",
      attendance: null,
      lineups: {
        home: { formation: (hl && hl.team_formation) || null, lineup: homeLineup, bench: homeBench },
        away: { formation: (al && al.team_formation) || null, lineup: awayLineup, bench: awayBench },
      },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/settle", auth, async (req, res) => {
  await settleBets(); res.json({ ok: true });
});

app.get("/api/test", async (req, res) => {
  try {
    // Test each league and report back what we find
    const results = {};
    for (const league of FETCH_LEAGUES) {
      try {
        const from = new Date().toISOString().split("T")[0];
        const to = new Date(Date.now()+14*86400000).toISOString().split("T")[0];
        const data = await apiFetch({ met: "Fixtures", leagueId: league.id, from, to });
        results[league.name] = { id: league.id, count: data.length, sample: data[0] ? data[0].league_name : "none" };
      } catch(e) { results[league.name] = { error: e.message }; }
      await delay(500);
    }
    res.json({ ok: true, db: !!db, leagues: results });
  } catch(e) { res.json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, "build")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "build", "index.html")));

connectDB().then(() => {
  app.listen(PORT, () => console.log("BetPlay on port " + PORT));
}).catch(e => { console.error("MongoDB failed:", e.message); process.exit(1); });
