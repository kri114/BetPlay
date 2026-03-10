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
const API_KEY    = process.env.FOOTBALL_API_KEY || "85d2d7c1bcmsh73cb83966d0e12ap1e9e33jsnae25fa75e926";
const API_BASE   = "https://api-football-v1.p.rapidapi.com/v3";
const API_HOST   = "api-football-v1.p.rapidapi.com";
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

// ── API-Football fetch ────────────────────────────────────────────────────────
async function apiFetch(path) {
  const res = await fetch(API_BASE + path, {
    headers: {
      "X-RapidAPI-Key":  API_KEY,
      "X-RapidAPI-Host": API_HOST,
    }
  });
  if (!res.ok) throw new Error("API " + res.status);
  const data = await res.json();
  return data.response || [];
}

// League IDs on API-Football
const LEAGUES = [
  { id: 39,  name: "Premier League",   country: "England", color: "#3b82f6" },
  { id: 2,   name: "Champions League", country: "Europe",  color: "#fbbf24" },
  { id: 140, name: "La Liga",          country: "Spain",   color: "#ef4444" },
  { id: 78,  name: "Bundesliga",       country: "Germany", color: "#f59e0b" },
  { id: 135, name: "Serie A",          country: "Italy",   color: "#10b981" },
  { id: 61,  name: "Ligue 1",          country: "France",  color: "#8b5cf6" },
];

const LEAGUE_MAP = {};
LEAGUES.forEach(l => { LEAGUE_MAP[l.id] = l; });

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

// ── Parse fixture from API-Football ──────────────────────────────────────────
function parseFixture(f) {
  const fix   = f.fixture;
  const teams = f.teams;
  const goals = f.goals;
  const score = f.score;
  const league = f.league;
  const leagueInfo = LEAGUE_MAP[league && league.id] || { name: league && league.name, color: "#e8ff47", country: "" };

  const ss = fix.status && fix.status.short;
  let status = "upcoming";
  if (["1H","2H","HT","ET","BT","P","INT","LIVE"].includes(ss)) status = "live";
  else if (["FT","AET","PEN"].includes(ss)) status = "finished";

  const elapsed  = fix.status && fix.status.elapsed || null;
  const homeScore = goals && goals.home != null ? goals.home : null;
  const awayScore = goals && goals.away != null ? goals.away : null;
  const homeId   = teams && teams.home && teams.home.id || 1;
  const awayId   = teams && teams.away && teams.away.id || 2;
  const odds     = generateOdds(homeId, awayId, status === "live" ? elapsed : null, homeScore, awayScore);

  const ko = new Date(fix.date);
  const timeStr = ko.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" })
    + " " + ko.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });

  return {
    id: fix.id, fixtureId: fix.id,
    league: leagueInfo.name, leagueId: String(league && league.id),
    leagueColor: leagueInfo.color, leagueCountry: leagueInfo.country,
    leagueLogo: league && league.logo || null,
    home: teams && teams.home && teams.home.name || "TBA",
    away: teams && teams.away && teams.away.name || "TBA",
    homeLogo: teams && teams.home && teams.home.logo || null,
    awayLogo: teams && teams.away && teams.away.logo || null,
    time: timeStr, kickoffTs: ko.getTime(),
    status, elapsed,
    homeScore, awayScore,
    homeOdds: odds.homeOdds, drawOdds: odds.drawOdds, awayOdds: odds.awayOdds,
    winner: score && score.fulltime ? (goals.home > goals.away ? "HOME_TEAM" : goals.away > goals.home ? "AWAY_TEAM" : "DRAW") : null,
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
    const today = new Date().toISOString().split("T")[0];
    const from  = new Date(); from.setDate(from.getDate() - 2);
    const to    = new Date(); to.setDate(to.getDate() + 7);
    const df = from.toISOString().split("T")[0];
    const dt = to.toISOString().split("T")[0];

    const all = [], seen = new Set();
    for (const league of LEAGUES) {
      try {
        const fixtures = await apiFetch("/fixtures?league=" + league.id + "&season=2025&from=" + df + "&to=" + dt);
        for (const f of fixtures) {
          const id = f.fixture && f.fixture.id;
          if (id && !seen.has(id)) { all.push(parseFixture(f)); seen.add(id); }
        }
        console.log("Fetched", league.name, "-", fixtures.length, "fixtures");
      } catch(e) { console.warn("Failed", league.name, e.message); }
      await delay(6200);
    }

    all.sort((a, b) => {
      const ord = { live:0, upcoming:1, finished:2 };
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return a.kickoffTs - b.kickoffTs;
    });

    if (all.length > 0) {
      _fixturesCache = all;
      _fixturesCacheTs = Date.now();
      console.log("Fixtures built:", all.length, "matches,", all.filter(m => m.status === "live").length, "live");
    }
  } catch(e) { console.error("buildFixtures error:", e.message); }
  finally { _fixturesRefreshing = false; }
}

setTimeout(buildFixtures, 500);
setInterval(function() {
  const hasLive = (_fixturesCache || []).some(m => m.status === "live");
  const age = Date.now() - _fixturesCacheTs;
  const ttl = hasLive ? 30000 : 5 * 60 * 1000;
  if (age > ttl) buildFixtures();
}, 30000);

// ── Bet settlement ────────────────────────────────────────────────────────────
async function settleBets() {
  const pending = await db.collection("bets").find({ status: "pending" }).toArray();
  if (!pending.length) return;
  const ids = [...new Set(pending.map(b => b.fixtureId))];
  for (const fid of ids) {
    let fixtures;
    try { fixtures = await apiFetch("/fixtures?id=" + fid); }
    catch(e) { console.warn("Settlement fetch failed", fid, e.message); continue; }
    const f = fixtures && fixtures[0];
    if (!f) continue;
    const ss = f.fixture && f.fixture.status && f.fixture.status.short;
    if (!["FT","AET","PEN"].includes(ss)) continue;
    const homeG = f.goals && f.goals.home;
    const awayG = f.goals && f.goals.away;
    if (homeG == null || awayG == null) continue;
    const total   = homeG + awayG;
    const winner  = homeG > awayG ? "HOME_TEAM" : awayG > homeG ? "AWAY_TEAM" : "DRAW";
    const scoreStr = homeG + "-" + awayG;
    const homeName = (f.teams && f.teams.home && f.teams.home.name || "").toLowerCase();
    const awayName = (f.teams && f.teams.away && f.teams.away.name || "").toLowerCase();
    const htHome  = f.score && f.score.halftime && f.score.halftime.home;
    const htAway  = f.score && f.score.halftime && f.score.halftime.away;

    const betsHere = pending.filter(b => String(b.fixtureId) === String(fid));
    for (const bet of betsHere) {
      const opt = (bet.option_label || "").toLowerCase();
      let won = false, refund = false;
      switch(bet.market) {
        case "Match Result":
          if (winner === "HOME_TEAM") won = opt.includes(homeName);
          else if (winner === "AWAY_TEAM") won = opt.includes(awayName);
          else won = opt === "draw";
          break;
        case "Both Teams to Score":
          won = (opt.includes("yes") && homeG > 0 && awayG > 0) || (opt.includes("no") && !(homeG > 0 && awayG > 0));
          break;
        case "Over / Under 1.5 Goals":
          won = (opt.startsWith("over") && total > 1) || (opt.startsWith("under") && total <= 1); break;
        case "Over / Under 2.5 Goals":
          won = (opt.startsWith("over") && total > 2) || (opt.startsWith("under") && total <= 2); break;
        case "Over / Under 3.5 Goals":
          won = (opt.startsWith("over") && total > 3) || (opt.startsWith("under") && total <= 3); break;
        case "Double Chance":
          if (winner === "HOME_TEAM") won = opt.includes(homeName) || (opt.includes("or") && !opt.includes(awayName));
          else if (winner === "AWAY_TEAM") won = opt.includes(awayName) || (opt.includes("or") && !opt.includes(homeName));
          else won = opt.includes(" or ");
          break;
        case "Half-Time Result":
          if (htHome != null && htAway != null) {
            const htW = htHome > htAway ? "HOME_TEAM" : htAway > htHome ? "AWAY_TEAM" : "DRAW";
            if (opt.includes("ht draw")) won = htW === "DRAW";
            else if (opt.includes(homeName)) won = htW === "HOME_TEAM";
            else if (opt.includes(awayName)) won = htW === "AWAY_TEAM";
          }
          break;
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
    await delay(300);
  }
}
setInterval(settleBets, 90000);
setTimeout(settleBets, 8000);

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
    const [fixtures, lineupData, eventsData] = await Promise.all([
      apiFetch("/fixtures?id=" + req.params.id),
      apiFetch("/fixtures/lineups?fixture=" + req.params.id),
      apiFetch("/fixtures/events?fixture=" + req.params.id),
    ]);

    const f  = fixtures && fixtures[0];
    const fix = f && f.fixture;
    const goals = f && f.goals;
    const score = f && f.score;
    const teams = f && f.teams;

    // Events - goals, cards etc
    const events = (eventsData || [])
      .filter(e => e.type === "Goal")
      .map(e => ({
        type: "Goal",
        player: { name: e.player && e.player.name || "Unknown" },
        team:   { name: e.team   && e.team.name   || "" },
        time:   { elapsed: e.time && e.time.elapsed },
      }));

    // Lineups - API-Football returns array of 2 team objects
    const homeLineupRaw = lineupData && lineupData[0];
    const awayLineupRaw = lineupData && lineupData[1];

    const mapPlayer = p => ({
      name: p.player && p.player.name || "",
      shirtNumber: p.player && p.player.number || null,
      position: p.player && p.player.pos || null,
    });

    const homeLineup = (homeLineupRaw && homeLineupRaw.startXI  || []).map(mapPlayer);
    const homeBench  = (homeLineupRaw && homeLineupRaw.substitutes || []).map(mapPlayer);
    const awayLineup = (awayLineupRaw && awayLineupRaw.startXI  || []).map(mapPlayer);
    const awayBench  = (awayLineupRaw && awayLineupRaw.substitutes || []).map(mapPlayer);

    res.json({
      events,
      fullTime:  goals ? { home: goals.home, away: goals.away } : null,
      halfTime:  score && score.halftime ? { home: score.halftime.home, away: score.halftime.away } : null,
      status:    fix && fix.status && fix.status.short || "",
      elapsed:   fix && fix.status && fix.status.elapsed || null,
      winner:    goals ? (goals.home > goals.away ? "HOME_TEAM" : goals.away > goals.home ? "AWAY_TEAM" : "DRAW") : null,
      homeTeam:  teams && teams.home && teams.home.name || "",
      awayTeam:  teams && teams.away && teams.away.name || "",
      referees:  (f && f.fixture && f.fixture.referee) || "",
      venue:     fix && fix.venue && fix.venue.name || "",
      attendance: null,
      lineups: {
        home: { formation: homeLineupRaw && homeLineupRaw.formation || null, lineup: homeLineup, bench: homeBench },
        away: { formation: awayLineupRaw && awayLineupRaw.formation || null, lineup: awayLineup, bench: awayBench },
      },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/settle", auth, async (req, res) => {
  await settleBets(); res.json({ ok: true });
});

app.get("/api/test", async (req, res) => {
  try {
    const data = await apiFetch("/fixtures?league=39&season=2025&next=3");
    res.json({ ok: true, fixtures: data.length, db: !!db });
  } catch(e) { res.json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, "build")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "build", "index.html")));

connectDB().then(() => {
  app.listen(PORT, () => console.log("BetPlay on port " + PORT));
}).catch(e => { console.error("MongoDB failed:", e.message); process.exit(1); });
