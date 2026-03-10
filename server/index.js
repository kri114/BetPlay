const express   = require("express");
const cors      = require("cors");
const fetch     = require("node-fetch");
const bcrypt    = require("bcryptjs");
const jwt       = require("jsonwebtoken");
const path      = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const app       = express();
const PORT      = process.env.PORT || 3001;
const JWT_SECRET= process.env.JWT_SECRET || "betplay_secret_2026";
const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://BetPlay:eekk1104@betplay.sig2icr.mongodb.net/BetPlay?appName=BetPlay";

// ESPN - no API key needed
const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/soccer";

app.use(cors());
app.use(express.json());

// MongoDB
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

// ESPN leagues - full list
const LEAGUES = [
  // Top European
  { slug:"eng.1",          name:"Premier League",      country:"England",     color:"#3b82f6" },
  { slug:"uefa.champions", name:"Champions League",    country:"Europe",      color:"#fbbf24" },
  { slug:"esp.1",          name:"La Liga",             country:"Spain",       color:"#ef4444" },
  { slug:"ger.1",          name:"Bundesliga",          country:"Germany",     color:"#f59e0b" },
  { slug:"ita.1",          name:"Serie A",             country:"Italy",       color:"#10b981" },
  { slug:"fra.1",          name:"Ligue 1",             country:"France",      color:"#8b5cf6" },
  { slug:"uefa.europa",    name:"Europa League",       country:"Europe",      color:"#f97316" },
  { slug:"uefa.europa.conf",name:"Conference League",  country:"Europe",      color:"#06b6d4" },
  { slug:"eng.2",          name:"Championship",        country:"England",     color:"#60a5fa" },
  { slug:"esp.2",          name:"La Liga 2",           country:"Spain",       color:"#fca5a5" },
  { slug:"ger.2",          name:"2. Bundesliga",       country:"Germany",     color:"#fcd34d" },
  { slug:"ita.2",          name:"Serie B",             country:"Italy",       color:"#6ee7b7" },
  { slug:"fra.2",          name:"Ligue 2",             country:"France",      color:"#c4b5fd" },
  { slug:"ned.1",          name:"Eredivisie",          country:"Netherlands", color:"#f87171" },
  { slug:"por.1",          name:"Primeira Liga",       country:"Portugal",    color:"#4ade80" },
  { slug:"sco.1",          name:"Scottish Premiership",country:"Scotland",    color:"#818cf8" },
  { slug:"bel.1",          name:"Belgian Pro League",  country:"Belgium",     color:"#fb923c" },
  { slug:"tur.1",          name:"Super Lig",           country:"Turkey",      color:"#e879f9" },
  { slug:"gre.1",          name:"Super League",        country:"Greece",      color:"#38bdf8" },
  { slug:"rus.1",          name:"Premier League",      country:"Russia",      color:"#a78bfa" },
  // Cup competitions
  { slug:"eng.fa",         name:"FA Cup",              country:"England",     color:"#93c5fd" },
  { slug:"eng.league_cup", name:"Carabao Cup",         country:"England",     color:"#86efac" },
  { slug:"esp.copa_del_rey",name:"Copa del Rey",       country:"Spain",       color:"#fda4af" },
  { slug:"ger.dfb_pokal",  name:"DFB Pokal",           country:"Germany",     color:"#fde68a" },
  { slug:"ita.coppa_italia",name:"Coppa Italia",       country:"Italy",       color:"#a7f3d0" },
  { slug:"fra.coupe_de_france",name:"Coupe de France", country:"France",      color:"#ddd6fe" },
  // Americas
  { slug:"usa.1",          name:"MLS",                 country:"USA",         color:"#67e8f9" },
  { slug:"bra.1",          name:"Brasileirao",         country:"Brazil",      color:"#bbf7d0" },
  { slug:"arg.1",          name:"Liga Profesional",    country:"Argentina",   color:"#fef08a" },
  { slug:"mex.1",          name:"Liga MX",             country:"Mexico",      color:"#fed7aa" },
  { slug:"col.1",          name:"Primera A",           country:"Colombia",    color:"#fecdd3" },
  { slug:"chi.1",          name:"Primera Division",    country:"Chile",       color:"#e0e7ff" },
  { slug:"conmebol.libertadores",name:"Copa Libertadores",country:"S.America",color:"#fef3c7" },
  { slug:"conmebol.sudamericana",name:"Copa Sudamericana",country:"S.America",color:"#ede9fe" },
  { slug:"concacaf.champions",name:"Concacaf Champions",country:"CONCACAF",   color:"#cffafe" },
  // Asia & Middle East
  { slug:"ksa.1",          name:"Saudi Pro League",    country:"Saudi Arabia",color:"#d1fae5" },
  { slug:"jpn.1",          name:"J.League",            country:"Japan",       color:"#fee2e2" },
  { slug:"chn.1",          name:"Chinese Super League",country:"China",       color:"#fce7f3" },
  { slug:"ind.1",          name:"Indian Super League", country:"India",       color:"#e0f2fe" },
  { slug:"afc.champions",  name:"AFC Champions League",country:"Asia",        color:"#f0fdf4" },
  // Africa
  { slug:"caf.champions",  name:"CAF Champions League",country:"Africa",      color:"#fef9c3" },
  // International
  { slug:"fifa.world",     name:"FIFA World Cup",      country:"International",color:"#ecfdf5" },
  { slug:"uefa.euro",      name:"UEFA Euro",           country:"Europe",      color:"#eff6ff" },
  { slug:"conmebol.america",name:"Copa America",       country:"S.America",   color:"#fff7ed" },
  { slug:"uefa.nations",   name:"UEFA Nations League", country:"Europe",      color:"#f5f3ff" },
  { slug:"fifa.cwc",       name:"Club World Cup",      country:"International",color:"#fdf2f8" },
  // Women's
  { slug:"eng.w.1",        name:"Women's Super League",country:"England",     color:"#fce7f3" },
  { slug:"uefa.wchampions",name:"Women's Champions League",country:"Europe",  color:"#fdf4ff" },
  { slug:"usa.nwsl",       name:"NWSL",                country:"USA",         color:"#f0f9ff" },
  { slug:"fifa.wwc",       name:"Women's World Cup",   country:"International",color:"#fef2f2" },
];

// Simple in-memory cache
const cache = new Map();
async function espnFetch(url, ttl) {
  if (ttl > 0) {
    const c = cache.get(url);
    if (c && Date.now() - c.ts < ttl) return c.data;
  }
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error("ESPN " + res.status + " " + url.slice(0, 80));
  const data = await res.json();
  cache.set(url, { data, ts: Date.now() });
  return data;
}

// Odds generator
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

// Parse ESPN scoreboard event
function parseESPNEvent(ev, league) {
  const comp   = ev.competitions && ev.competitions[0];
  const competitors = (comp && comp.competitors) || [];
  const home   = competitors.find(c => c.homeAway === "home") || competitors[0] || {};
  const away   = competitors.find(c => c.homeAway === "away") || competitors[1] || {};
  const status = comp && comp.status;
  const stateVal = status && status.type && status.type.state; // "pre","in","post"
  const detail   = status && status.type && status.type.shortDetail || "";

  let matchStatus = "upcoming";
  if (stateVal === "in") matchStatus = "live";
  else if (stateVal === "post") matchStatus = "finished";

  const elapsed   = matchStatus === "live" ? (status && status.displayClock ? parseInt(status.displayClock) : null) : null;
  const homeScore = (matchStatus === "live" || matchStatus === "finished") ? parseInt(home.score || 0) : null;
  const awayScore = (matchStatus === "live" || matchStatus === "finished") ? parseInt(away.score || 0) : null;

  const homeId = parseInt(home.id || "1");
  const awayId = parseInt(away.id || "2");
  const odds   = generateOdds(homeId, awayId, matchStatus === "live" ? elapsed : null, homeScore, awayScore);

  const ko = new Date(ev.date || comp && comp.date);
  const timeStr = ko.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" })
    + " " + ko.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });

  const homeLogo = home.team && home.team.logo || null;
  const awayLogo = away.team && away.team.logo || null;

  let winner = null;
  if (matchStatus === "finished") {
    if (homeScore > awayScore) winner = "HOME_TEAM";
    else if (awayScore > homeScore) winner = "AWAY_TEAM";
    else winner = "DRAW";
  }

  return {
    id: ev.id, fixtureId: ev.id,
    league: league.name, leagueId: league.slug,
    leagueColor: league.color, leagueCountry: league.country,
    leagueLogo: null,
    home: (home.team && (home.team.shortDisplayName || home.team.displayName)) || "TBA",
    away: (away.team && (away.team.shortDisplayName || away.team.displayName)) || "TBA",
    homeTeamId: homeId, awayTeamId: awayId,
    homeLogo, awayLogo,
    time: timeStr, kickoffTs: ko.getTime(),
    status: matchStatus, elapsed,
    homeScore, awayScore,
    homeOdds: odds.homeOdds, drawOdds: odds.drawOdds, awayOdds: odds.awayOdds,
    winner,
    espnLeagueSlug: league.slug,
  };
}

// Fixtures cache
let _fixturesCache = null;
let _fixturesCacheTs = 0;
let _fixturesRefreshing = false;

async function buildFixtures() {
  if (_fixturesRefreshing) return;
  _fixturesRefreshing = true;
  try {
    const all = [], seen = new Set();

    // Fetch today -2 to +7 days
    const dates = [];
    for (let i = -2; i <= 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split("T")[0].replace(/-/g, ""));
    }

    for (const league of LEAGUES) {
      try {
        // ESPN scoreboard accepts date ranges
        const url = `${ESPN_SITE}/${league.slug}/scoreboard?dates=${dates[0]}-${dates[dates.length-1]}&limit=100`;
        const data = await espnFetch(url, 0);
        const events = data.events || [];
        for (const ev of events) {
          if (!seen.has(ev.id)) {
            all.push(parseESPNEvent(ev, league));
            seen.add(ev.id);
          }
        }
        console.log("ESPN fetched", league.name, events.length, "events");
      } catch(e) {
        // Try individual dates if range doesn't work
        console.warn("Range fetch failed for", league.name, e.message, "- trying today only");
        try {
          const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
          const url2 = `${ESPN_SITE}/${league.slug}/scoreboard?dates=${today}&limit=50`;
          const data2 = await espnFetch(url2, 0);
          for (const ev of (data2.events || [])) {
            if (!seen.has(ev.id)) { all.push(parseESPNEvent(ev, league)); seen.add(ev.id); }
          }
        } catch(e2) { console.warn("Today fetch also failed", league.name, e2.message); }
      }
      await delay(300); // gentle on ESPN
    }

    all.sort((a, b) => {
      const ord = { live:0, upcoming:1, finished:2 };
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return a.kickoffTs - b.kickoffTs;
    });

    if (all.length > 0) {
      _fixturesCache = all;
      _fixturesCacheTs = Date.now();
      console.log("Fixtures ready:", all.length, "total,", all.filter(m => m.status === "live").length, "live");
    } else {
      console.warn("No fixtures fetched!");
    }
  } catch(e) { console.error("buildFixtures error:", e.message); }
  finally { _fixturesRefreshing = false; }
}

setTimeout(buildFixtures, 500);
setInterval(function() {
  const hasLive = (_fixturesCache||[]).some(m => m.status === "live");
  const age = Date.now() - _fixturesCacheTs;
  if (age > (hasLive ? 30000 : 5*60*1000)) buildFixtures();
}, 30000);

// Bet settlement
async function settleBets() {
  const pending = await db.collection("bets").find({ status: "pending" }).toArray();
  if (!pending.length) return;
  const ids = [...new Set(pending.map(b => b.fixtureId))];
  for (const fid of ids) {
    // Find fixture in cache first
    const cached = (_fixturesCache||[]).find(m => String(m.id) === String(fid));
    if (!cached || cached.status !== "finished") continue;
    const homeG = cached.homeScore, awayG = cached.awayScore;
    if (homeG == null || awayG == null) continue;
    const total = homeG + awayG;
    const winner = cached.winner;
    const scoreStr = homeG + "-" + awayG;
    const homeName = cached.home.toLowerCase();
    const awayName = cached.away.toLowerCase();
    const betsHere = pending.filter(b => String(b.fixtureId) === String(fid));
    for (const bet of betsHere) {
      const opt = (bet.option_label || "").toLowerCase();
      let won = false, refund = false;
      switch(bet.market) {
        case "Match Result":
          if (winner==="HOME_TEAM") won = opt.includes(homeName);
          else if (winner==="AWAY_TEAM") won = opt.includes(awayName);
          else won = opt==="draw"; break;
        case "Both Teams to Score":
          won = (opt.includes("yes")&&homeG>0&&awayG>0)||(opt.includes("no")&&!(homeG>0&&awayG>0)); break;
        case "Over / Under 1.5 Goals":
          won = (opt.startsWith("over")&&total>1)||(opt.startsWith("under")&&total<=1); break;
        case "Over / Under 2.5 Goals":
          won = (opt.startsWith("over")&&total>2)||(opt.startsWith("under")&&total<=2); break;
        case "Over / Under 3.5 Goals":
          won = (opt.startsWith("over")&&total>3)||(opt.startsWith("under")&&total<=3); break;
        case "Double Chance":
          if (winner==="HOME_TEAM") won = opt.includes(homeName)||(opt.includes("or")&&!opt.includes(awayName));
          else if (winner==="AWAY_TEAM") won = opt.includes(awayName)||(opt.includes("or")&&!opt.includes(homeName));
          else won = opt.includes(" or "); break;
        case "Half-Time Result": refund = true; break;
        case "Correct Score": won = opt===scoreStr; break;
        case "Total Cards": case "Total Corners": case "Anytime Scorer": refund = true; break;
      }
      const now = new Date().toISOString();
      if (refund) {
        await db.collection("bets").updateOne({ _id:bet._id }, { $set:{ status:"refunded", settled_at:now } });
        await db.collection("users").updateOne({ _id:bet.userId }, { $inc:{ balance:bet.amount } });
      } else {
        await db.collection("bets").updateOne({ _id:bet._id }, { $set:{ status:won?"won":"lost", settled_at:now } });
        if (won) await db.collection("users").updateOne({ _id:bet.userId }, { $inc:{ balance:bet.potential } });
      }
    }
  }
}
setInterval(settleBets, 90000);
setTimeout(settleBets, 8000);

// Auth
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
    res.json({ id: req.user.id, username: user.username, balance: user.balance, joined: user.joined, bets: bets.map(b => ({ ...b, id: b._id.toString(), userId: b.userId.toString() })) });
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
    const bet = { userId: user._id, fixtureId, match_label: matchLabel, league, leagueId, option_label: optionLabel, market, amount, odds, potential: Math.round(potential*100)/100, match_time: matchTime, status: "pending", placed_at: new Date().toISOString() };
    const result = await db.collection("bets").insertOne(bet);
    setTimeout(settleBets, 3000);
    res.json({ bet: { ...bet, id: result.insertedId.toString(), userId: req.user.id }, balance: newBalance });
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
      return { id: u._id.toString(), username: u.username, balance: u.balance, total_bets: bets.length, wins: bets.filter(b => b.status==="won").length };
    }));
    rows.sort((a, b) => b.balance - a.balance);
    res.json(rows.slice(0, 50));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/fixtures", auth, (req, res) => {
  if (!_fixturesCache) return res.json({ response: [], total: 0, loading: true });
  res.json({ response: _fixturesCache, total: _fixturesCache.length });
});

// Match stats + lineups via ESPN summary endpoint
app.get("/api/fixtures/:id/stats", auth, async (req, res) => {
  try {
    const fid = req.params.id;
    // Find which league this match belongs to
    const cached = (_fixturesCache||[]).find(m => String(m.id) === String(fid));
    const leagueSlug = (cached && cached.espnLeagueSlug) || "eng.1";

    const url = `${ESPN_SITE}/${leagueSlug}/summary?event=${fid}`;
    const data = await espnFetch(url, 30000);

    // Goals from plays/scoring summary
    const scoringPlays = data.scoringPlays || [];
    const events = scoringPlays.map(p => ({
      type: "Goal",
      player: { name: (p.athletesInvolved && p.athletesInvolved[0] && p.athletesInvolved[0].displayName) || "Unknown" },
      team: { name: (p.team && p.team.displayName) || "" },
      time: { elapsed: p.period && p.clock ? parseInt(p.clock.displayValue) : null },
    }));

    // Lineups from rosters
    const rosters = data.rosters || [];
    const homeRoster = rosters.find(r => r.homeAway === "home") || {};
    const awayRoster = rosters.find(r => r.homeAway === "away") || {};

    const mapPlayer = p => {
      const athlete = p.athlete || {};
      return {
        name: athlete.displayName || athlete.shortName || "",
        shirtNumber: p.jersey || athlete.jersey || null,
        position: p.position && p.position.abbreviation || null,
      };
    };

    const homeStarters = (homeRoster.roster || []).filter(p => p.starter);
    const homeSubs     = (homeRoster.roster || []).filter(p => !p.starter);
    const awayStarters = (awayRoster.roster || []).filter(p => p.starter);
    const awaySubs     = (awayRoster.roster || []).filter(p => !p.starter);

    // Score info
    const header = data.header || {};
    const comp   = header.competitions && header.competitions[0];
    const competitors = (comp && comp.competitors) || [];
    const homeComp = competitors.find(c => c.homeAway === "home") || {};
    const awayComp = competitors.find(c => c.homeAway === "away") || {};
    const stateVal = comp && comp.status && comp.status.type && comp.status.type.state;
    let status = "upcoming";
    if (stateVal === "in") status = "live";
    else if (stateVal === "post") status = "finished";
    const homeScore = parseInt(homeComp.score || 0);
    const awayScore = parseInt(awayComp.score || 0);

    // Venue
    const gameInfo = data.gameInfo || {};
    const venue = gameInfo.venue && gameInfo.venue.fullName || "";

    // Officials
    const officials = (gameInfo.officials || []).map(o => o.displayName).join(", ");

    res.json({
      events,
      fullTime: (status === "finished" || status === "live") ? { home: homeScore, away: awayScore } : null,
      halfTime: null,
      status,
      elapsed: comp && comp.status && comp.status.displayClock ? parseInt(comp.status.displayClock) : null,
      winner: status === "finished" ? (homeScore > awayScore ? "HOME_TEAM" : awayScore > homeScore ? "AWAY_TEAM" : "DRAW") : null,
      homeTeam: (homeComp.team && homeComp.team.displayName) || "",
      awayTeam: (awayComp.team && awayComp.team.displayName) || "",
      referees: officials,
      venue,
      attendance: gameInfo.attendance || null,
      lineups: {
        home: { formation: homeRoster.formation || null, lineup: homeStarters.map(mapPlayer), bench: homeSubs.map(mapPlayer) },
        away: { formation: awayRoster.formation || null, lineup: awayStarters.map(mapPlayer), bench: awaySubs.map(mapPlayer) },
      },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/settle", auth, async (req, res) => { await settleBets(); res.json({ ok: true }); });

app.get("/api/test", async (req, res) => {
  try {
    const url = `${ESPN_SITE}/eng.1/scoreboard`;
    const data = await espnFetch(url, 0);
    res.json({ ok: true, events: (data.events||[]).length, db: !!db });
  } catch(e) { res.json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, "build")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "build", "index.html")));

connectDB().then(() => {
  app.listen(PORT, () => console.log("BetPlay on port " + PORT));
}).catch(e => { console.error("MongoDB failed:", e.message); process.exit(1); });
