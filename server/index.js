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
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

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

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ── Real league logos ─────────────────────────────────────────────────────────
const COMPETITIONS = [
  { code:"PL",  name:"Premier League",   country:"England", color:"#3b82f6",
    logo:"https://upload.wikimedia.org/wikipedia/en/f/f2/Premier_League_Logo.svg" },
  { code:"CL",  name:"Champions League", country:"Europe",  color:"#fbbf24",
    logo:"https://upload.wikimedia.org/wikipedia/en/b/bf/UEFA_Champions_League_logo_2.svg" },
  { code:"PD",  name:"La Liga",          country:"Spain",   color:"#ef4444",
    logo:"https://upload.wikimedia.org/wikipedia/commons/5/54/LaLiga_EA_Sports_logo_%28introduced_2023%29.svg" },
  { code:"BL1", name:"Bundesliga",       country:"Germany", color:"#f59e0b",
    logo:"https://upload.wikimedia.org/wikipedia/en/d/df/Bundesliga_logo_%282017%29.svg" },
  { code:"SA",  name:"Serie A",          country:"Italy",   color:"#10b981",
    logo:"https://upload.wikimedia.org/wikipedia/en/e/e1/Serie_A_logo_%282019%29.svg" },
  { code:"FL1", name:"Ligue 1",          country:"France",  color:"#8b5cf6",
    logo:"https://upload.wikimedia.org/wikipedia/commons/c/c7/Ligue1_-_Uber_Eats_Logo_2020.svg" },
];

// ── AI Odds via Claude ────────────────────────────────────────────────────────
// Cache odds per match to avoid hammering the API
const oddsCache = new Map();

async function getAIOdds(home, away, league, elapsed, homeScore, awayScore) {
  const key = home + "|" + away + "|" + elapsed + "|" + homeScore + "|" + awayScore;
  if (oddsCache.has(key)) return oddsCache.get(key);

  // If no Anthropic key, fall back to formula-based odds
  if (!ANTHROPIC_KEY) return formulaOdds(home, away, elapsed, homeScore, awayScore);

  try {
    const isLive = elapsed != null;
    const prompt = isLive
      ? `You are a professional football betting odds compiler. Generate realistic betting odds for this LIVE match.

Match: ${home} vs ${away} (${league})
Current score: ${homeScore}-${awayScore} at minute ${elapsed}

Generate odds as a JSON object with these exact keys:
homeWin, draw, awayWin

Rules:
- Reflect the current scoreline and time remaining (90 - ${elapsed} minutes left)
- A team winning should have much shorter odds to win
- A team losing with little time left should have very long odds
- Odds must be realistic (homeWin 1.05-15.0, draw 1.5-12.0, awayWin 1.05-15.0)
- All odds must be numbers with 2 decimal places
- Do NOT include any explanation, only the JSON object`
      : `You are a professional football betting odds compiler. Generate realistic pre-match betting odds.

Match: ${home} vs ${away} (${league})

Generate odds as a JSON object with these exact keys:
homeWin, draw, awayWin

Rules:
- Use real knowledge of these teams' quality and recent form if you know them
- Home advantage typically gives a 10-15% boost
- Odds must be realistic (homeWin 1.20-6.0, draw 2.5-4.5, awayWin 1.20-8.0)
- All odds must be numbers with 2 decimal places
- A clear favourite should have odds around 1.40-1.90, underdog 2.50-5.00
- Do NOT include any explanation, only the JSON object`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) throw new Error("Anthropic API " + res.status);
    const data = await res.json();
    const text = data.content && data.content[0] && data.content[0].text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    const odds = {
      homeOdds: Math.max(1.05, Math.min(20, +Number(parsed.homeWin).toFixed(2))),
      drawOdds: Math.max(1.50, Math.min(15, +Number(parsed.draw).toFixed(2))),
      awayOdds: Math.max(1.05, Math.min(20, +Number(parsed.awayWin).toFixed(2))),
    };

    // Cache for 60s live, 10 min pre-match
    const ttl = isLive ? 60000 : 10 * 60 * 1000;
    oddsCache.set(key, odds);
    setTimeout(() => oddsCache.delete(key), ttl);
    return odds;
  } catch(e) {
    console.warn("AI odds failed:", e.message, "- using formula");
    return formulaOdds(home, away, elapsed, homeScore, awayScore);
  }
}

function formulaOdds(home, away, elapsed, homeScore, awayScore) {
  // Deterministic seed from team names
  const hSeed = home.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const aSeed = away.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const hStr  = ((hSeed * 7 + 13) % 100) / 100;
  const aStr  = ((aSeed * 11 + 7) % 100) / 100;
  const hAdj  = hStr * 0.6 + 0.2;
  const aAdj  = aStr * 0.6 + 0.1;

  let hOdds = Math.max(1.20, +(4.5 - hAdj * 3.0).toFixed(2));
  let aOdds = Math.max(1.30, +(5.0 - aAdj * 3.0).toFixed(2));
  let dOdds = +(2.8 + Math.abs(hAdj - aAdj) * 0.8).toFixed(2);

  if (elapsed != null && homeScore != null && awayScore != null) {
    const diff = homeScore - awayScore;
    const timeLeft = Math.max(1, 90 - elapsed);
    const urgency = 90 / (timeLeft + 10);
    if (diff > 0) {
      hOdds = Math.max(1.05, +(hOdds - diff * 0.5 * urgency).toFixed(2));
      aOdds = Math.min(18.0, +(aOdds + diff * 0.7 * urgency).toFixed(2));
      dOdds = Math.min(12.0, +(dOdds + diff * 0.4 * urgency).toFixed(2));
    } else if (diff < 0) {
      aOdds = Math.max(1.05, +(aOdds + diff * 0.5 * urgency).toFixed(2));
      hOdds = Math.min(18.0, +(hOdds - diff * 0.7 * urgency).toFixed(2));
      dOdds = Math.min(12.0, +(dOdds - diff * 0.4 * urgency).toFixed(2));
    }
  }
  return { homeOdds: hOdds, drawOdds: dOdds, awayOdds: aOdds };
}

async function parseMatch(m, comp) {
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

  const home = (m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || "TBA";
  const away = (m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || "TBA";
  const elapsed = m.minute || null;

  // Get AI odds (only for upcoming and live, not finished)
  let odds = { homeOdds: 2.50, drawOdds: 3.20, awayOdds: 2.80 };
  if (status !== "finished") {
    odds = await getAIOdds(home, away, comp.name,
      status === "live" ? elapsed : null, homeScore, awayScore);
  }

  return {
    id: m.id, fixtureId: m.id,
    league: comp.name, leagueId: comp.code,
    leagueColor: comp.color, leagueCountry: comp.country,
    leagueLogo: comp.logo,
    home, away,
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
    try { raw = await fetch(API_BASE + "/matches/" + fid, { headers: { "X-Auth-Token": API_KEY } }).then(r => r.json()); }
    catch(e) { continue; }
    const m = (raw.id ? raw : raw.match) || raw;
    if (!["FINISHED","AWARDED"].includes(m.status)) continue;
    const ft = m.score && m.score.fullTime;
    if (!ft || ft.home == null || ft.away == null) continue;
    const homeG = ft.home, awayG = ft.away, total = homeG + awayG;
    const winner = m.score.winner;
    const scoreStr = homeG + "-" + awayG;
    const htScore = m.score && m.score.halfTime;
    const homeName = ((m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || "").toLowerCase();
    const awayName = ((m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || "").toLowerCase();
    const betsHere = pending.filter(b => String(b.fixtureId) === String(fid));
    for (const bet of betsHere) {
      const opt = (bet.option_label || "").toLowerCase();
      let won = false, refund = false;
      switch(bet.market) {
        case "Match Result":
          if (winner==="HOME_TEAM") won = opt.includes(homeName);
          else if (winner==="AWAY_TEAM") won = opt.includes(awayName);
          else if (winner==="DRAW") won = opt==="draw";
          break;
        case "Both Teams to Score":
          const btts = homeG>0 && awayG>0;
          won = (opt.includes("yes")&&btts)||(opt.includes("no")&&!btts);
          break;
        case "Over / Under 1.5 Goals":
          won = (opt.startsWith("over")&&total>1)||(opt.startsWith("under")&&total<=1); break;
        case "Over / Under 2.5 Goals":
          won = (opt.startsWith("over")&&total>2)||(opt.startsWith("under")&&total<=2); break;
        case "Over / Under 3.5 Goals":
          won = (opt.startsWith("over")&&total>3)||(opt.startsWith("under")&&total<=3); break;
        case "Double Chance":
          if (winner==="HOME_TEAM") won = opt.includes(homeName)||(opt.includes("or")&&!opt.includes(awayName));
          else if (winner==="AWAY_TEAM") won = opt.includes(awayName)||(opt.includes("or")&&!opt.includes(homeName));
          else if (winner==="DRAW") won = opt.includes("or");
          break;
        case "Half-Time Result":
          if (htScore&&htScore.home!=null) {
            const htW = htScore.home>htScore.away?"HOME_TEAM":htScore.away>htScore.home?"AWAY_TEAM":"DRAW";
            if (opt.includes("ht draw")) won = htW==="DRAW";
            else if (opt.includes(homeName)) won = htW==="HOME_TEAM";
            else if (opt.includes(awayName)) won = htW==="AWAY_TEAM";
          }
          break;
        case "Correct Score": won = opt===scoreStr; break;
        case "Total Cards": case "Total Corners": case "Anytime Scorer": refund=true; break;
      }
      const now = new Date().toISOString();
      if (refund) {
        await db.collection("bets").updateOne({ _id:bet._id }, { $set:{ status:"refunded", settled_at:now } });
        await db.collection("users").updateOne({ _id:bet.userId }, { $inc:{ balance:bet.amount } });
      } else {
        await db.collection("bets").updateOne({ _id:bet._id }, { $set:{ status:won?"won":"lost", settled_at:now } });
        if (won) {
          await db.collection("users").updateOne({ _id:bet.userId }, { $inc:{ balance:bet.potential } });
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
    if (!username||!password) return res.status(400).json({ error:"Missing fields" });
    if (password.length<4) return res.status(400).json({ error:"Password too short (min 4)" });
    if (await db.collection("users").findOne({ username })) return res.status(409).json({ error:"Username taken" });
    const hash = bcrypt.hashSync(password, 10);
    const user = { username, password:hash, balance:100, joined:new Date().toISOString() };
    const result = await db.collection("users").insertOne(user);
    const id = result.insertedId.toString();
    const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn:"90d" });
    res.json({ token, user:{ id, username, balance:100, joined:user.joined } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = await db.collection("users").findOne({ username });
    if (!user||!bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error:"Invalid username or password" });
    const id = user._id.toString();
    const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn:"90d" });
    res.json({ token, user:{ id, username, balance:user.balance, joined:user.joined } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/api/me", auth, async (req, res) => {
  try {
    const user = await db.collection("users").findOne({ _id:new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ error:"User not found" });
    const bets = await db.collection("bets").find({ userId:new ObjectId(req.user.id) }).toArray();
    const safeBets = bets.map(b => ({ ...b, id:b._id.toString(), userId:b.userId.toString() }));
    res.json({ id:req.user.id, username:user.username, balance:user.balance, joined:user.joined, bets:safeBets });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/bet", auth, async (req, res) => {
  try {
    const { fixtureId, matchLabel, league, leagueId, optionLabel, market, amount, odds, potential, matchTime } = req.body || {};
    const user = await db.collection("users").findOne({ _id:new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ error:"User not found" });
    if (amount>user.balance) return res.status(400).json({ error:"Insufficient balance" });
    if (amount<1) return res.status(400).json({ error:"Min bet $1" });
    const newBalance = Math.round((user.balance-amount)*100)/100;
    await db.collection("users").updateOne({ _id:user._id }, { $set:{ balance:newBalance } });
    const bet = { userId:user._id, fixtureId, match_label:matchLabel, league, leagueId, option_label:optionLabel, market, amount, odds, potential:Math.round(potential*100)/100, match_time:matchTime, status:"pending", placed_at:new Date().toISOString() };
    const result = await db.collection("bets").insertOne(bet);
    setTimeout(settleBets, 3000);
    res.json({ bet:{ ...bet, id:result.insertedId.toString(), userId:req.user.id }, balance:newBalance });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/adreward", auth, async (req, res) => {
  try {
    const user = await db.collection("users").findOne({ _id:new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ error:"Not found" });
    const newBalance = Math.round((user.balance+10)*100)/100;
    await db.collection("users").updateOne({ _id:user._id }, { $set:{ balance:newBalance } });
    res.json({ balance:newBalance });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/api/leaderboard", auth, async (req, res) => {
  try {
    const users = await db.collection("users").find({}).toArray();
    const rows = await Promise.all(users.map(async u => {
      const bets = await db.collection("bets").find({ userId:u._id }).toArray();
      return { id:u._id.toString(), username:u.username, balance:u.balance, total_bets:bets.length, wins:bets.filter(b=>b.status==="won").length };
    }));
    rows.sort((a,b) => b.balance-a.balance);
    res.json(rows.slice(0,50));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Fixtures with smart cache ─────────────────────────────────────────────────
let _fixturesCache = null;
let _fixturesCacheTs = 0;
let _fixturesRefreshing = false;

async function buildFixtures() {
  if (_fixturesRefreshing) return;
  _fixturesRefreshing = true;
  try {
    const from = new Date(); from.setDate(from.getDate()-2);
    const to   = new Date(); to.setDate(to.getDate()+7);
    const df = from.toISOString().split("T")[0];
    const dt = to.toISOString().split("T")[0];
    const all = [], seen = new Set();
    for (const comp of COMPETITIONS) {
      try {
        const res2 = await fetch(API_BASE+"/competitions/"+comp.code+"/matches?dateFrom="+df+"&dateTo="+dt, { headers:{ "X-Auth-Token":API_KEY } });
        if (res2.status===429) { console.warn("Rate limited on", comp.code); }
        else if (res2.ok) {
          const data = await res2.json();
          for (const m of (data.matches||[])) {
            if (!seen.has(m.id)) {
              const parsed = await parseMatch(m, comp);
              all.push(parsed); seen.add(m.id);
            }
          }
        }
      } catch(e) { console.warn("Fetch failed", comp.code, e.message); }
      await delay(6200);
    }
    all.sort((a,b) => {
      const ord = { live:0, upcoming:1, finished:2 };
      if (ord[a.status]!==ord[b.status]) return ord[a.status]-ord[b.status];
      return a.kickoffTs-b.kickoffTs;
    });
    if (all.length>0) { _fixturesCache=all; _fixturesCacheTs=Date.now(); }
    console.log("Fixtures built:", (_fixturesCache||[]).length, "matches");
  } catch(e) { console.error("buildFixtures error:", e.message); }
  finally { _fixturesRefreshing=false; }
}

setTimeout(buildFixtures, 500);
setInterval(async function() {
  const hasLive = (_fixturesCache||[]).some(m => m.status==="live");
  const age = Date.now()-_fixturesCacheTs;
  const ttl = hasLive ? 30000 : 5*60*1000;
  if (age>ttl) buildFixtures();
}, 30000);

app.get("/api/fixtures", auth, (req, res) => {
  if (!_fixturesCache) return res.json({ response:[], total:0, loading:true });
  res.json({ response:_fixturesCache, total:_fixturesCache.length });
});

// ── Match detail ──────────────────────────────────────────────────────────────
app.get("/api/fixtures/:id/stats", auth, async (req, res) => {
  try {
    const raw = await fetch(API_BASE+"/matches/"+req.params.id, { headers:{ "X-Auth-Token":API_KEY } }).then(r=>r.json());
    // football-data.org v4 returns { match: {...} } or directly the match object
    const m = (raw.match && raw.match.id) ? raw.match : (raw.id ? raw : raw.match || raw);

    const ft = m.score && m.score.fullTime;
    const ht = m.score && m.score.halfTime;

    // Goals are in m.goals array: { minute, team:{id,name}, scorer:{id,name}, assist:{id,name} }
    const events = (m.goals || []).map(g => ({
      type: "Goal",
      player: { name: (g.scorer && g.scorer.name) || "Unknown" },
      team:   { name: (g.team   && g.team.name)   || "" },
      time:   { elapsed: g.minute },
    }));

    // Lineups: football-data.org v4 uses startingXI and substitutes (not lineup/bench)
    const mapPlayer = p => ({ name: p.name || "", shirtNumber: p.shirtNumber || null, position: p.position || null });
    const ht2 = m.homeTeam || {};
    const at2 = m.awayTeam || {};

    const homeLineup = (ht2.startingXI || ht2.lineup || []).map(mapPlayer);
    const awayLineup = (at2.startingXI || at2.lineup || []).map(mapPlayer);
    const homeBench  = (ht2.substitutes || ht2.bench  || []).map(mapPlayer);
    const awayBench  = (at2.substitutes || at2.bench  || []).map(mapPlayer);

    res.json({
      events,
      fullTime:  ft || null,
      halfTime:  ht || null,
      status:    m.status,
      elapsed:   m.minute || null,
      winner:    (m.score && m.score.winner) || null,
      homeTeam:  ht2.name || "",
      awayTeam:  at2.name || "",
      referees:  (m.referees || []).map(r => r.name).join(", "),
      venue:     m.venue || "",
      attendance: m.attendance || null,
      lineups: {
        home: { formation: ht2.formation || null, lineup: homeLineup, bench: homeBench },
        away: { formation: at2.formation || null, lineup: awayLineup, bench: awayBench },
      },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/settle", auth, async (req, res) => {
  await settleBets(); res.json({ ok:true });
});

app.get("/api/test", async (req, res) => {
  try {
    const data = await fetch(API_BASE+"/competitions/PL/matches?status=SCHEDULED", { headers:{ "X-Auth-Token":API_KEY } }).then(r=>r.json());
    res.json({ ok:true, scheduled:data.matches&&data.matches.length, db:!!db });
  } catch(e) { res.json({ error:e.message }); }
});

// Debug: dump raw match data to diagnose lineup fields
app.get("/api/debug/:id", async (req, res) => {
  try {
    const raw = await fetch(API_BASE+"/matches/"+req.params.id, { headers:{ "X-Auth-Token":API_KEY } }).then(r=>r.json());
    const m = (raw.match && raw.match.id) ? raw.match : (raw.id ? raw : raw.match || raw);
    res.json({
      status: m.status,
      minute: m.minute,
      hasGoals: !!(m.goals && m.goals.length),
      goalCount: (m.goals||[]).length,
      homeTeamKeys: m.homeTeam ? Object.keys(m.homeTeam) : [],
      awayTeamKeys: m.awayTeam ? Object.keys(m.awayTeam) : [],
      homeTeamSample: m.homeTeam ? {
        name: m.homeTeam.name,
        formation: m.homeTeam.formation,
        startingXICount: (m.homeTeam.startingXI||[]).length,
        substitutesCount: (m.homeTeam.substitutes||[]).length,
        lineupCount: (m.homeTeam.lineup||[]).length,
        benchCount: (m.homeTeam.bench||[]).length,
        firstPlayer: (m.homeTeam.startingXI||m.homeTeam.lineup||[])[0] || null,
      } : null,
      rawTopKeys: Object.keys(raw),
    });
  } catch(e) { res.json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, "build")));
app.get("*", (req,res) => res.sendFile(path.join(__dirname,"build","index.html")));

connectDB().then(() => {
  app.listen(PORT, () => console.log("BetPlay on port "+PORT));
}).catch(e => { console.error("Failed to connect to MongoDB:", e.message); process.exit(1); });
