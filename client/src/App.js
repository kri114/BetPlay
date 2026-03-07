import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const LEAGUES = [
  { id: 39,  name: "Premier League",   flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", color: "#3b82f6" },
  { id: 140, name: "La Liga",          flag: "🇪🇸",         color: "#ef4444" },
  { id: 78,  name: "Bundesliga",       flag: "🇩🇪",         color: "#f59e0b" },
  { id: 135, name: "Serie A",          flag: "🇮🇹",         color: "#10b981" },
  { id: 61,  name: "Ligue 1",          flag: "🇫🇷",         color: "#8b5cf6" },
  { id: 2,   name: "Champions League", flag: "⭐",           color: "#f59e0b" },
];

const BET_TYPES = [
  { id:"1x2",     label:"Match Result" },
  { id:"btts",    label:"Both Teams Score" },
  { id:"ou25",    label:"Over/Under 2.5" },
  { id:"ou35",    label:"Over/Under 3.5" },
  { id:"dc",      label:"Double Chance" },
  { id:"ht",      label:"Half-Time Result" },
  { id:"cs",      label:"Correct Score" },
  { id:"anytime", label:"Anytime Scorer" },
];

// ─── API CLIENT ───────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem("bp_token"); }

async function api(path, options = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmt(n) {
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function oddsFromPct(pct) {
  if (!pct || pct <= 0) return 9.99;
  return Math.max(1.05, Math.round((100 / pct) * 100) / 100);
}

function getLeague(name) { return LEAGUES.find(l => l.name === name) || {}; }

function parseFixture(f) {
  const leagueInfo = LEAGUES.find(l => l.id === f.league?.id) || {};
  const shortStatus = f.fixture?.status?.short;
  let status = "upcoming";
  if (["1H","HT","2H","ET","BT","P","LIVE","INT"].includes(shortStatus)) status = "live";
  else if (["FT","AET","PEN"].includes(shortStatus)) status = "finished";

  const score = f.score?.fulltime;
  const kickoff = new Date(f.fixture.date);
  const timeStr = kickoff.toLocaleDateString("en-GB", { day:"numeric", month:"short" }) +
    " · " + kickoff.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });

  // Use win_probability if available, else equal split
  const wp = f.predictions?.[0]?.predictions;
  const homePct = wp ? parseFloat(wp.percent?.home || 33) : 33;
  const drawPct = wp ? parseFloat(wp.percent?.draw || 33) : 33;
  const awayPct = wp ? parseFloat(wp.percent?.away || 34) : 34;

  return {
    id: f.fixture.id,
    fixtureId: f.fixture.id,
    league: leagueInfo.name || f.league?.name || "Unknown",
    leagueColor: leagueInfo.color || "#e8ff47",
    home: f.teams.home.name,
    away: f.teams.away.name,
    homeLogo: f.teams.home.logo,
    awayLogo: f.teams.away.logo,
    time: timeStr,
    kickoffTs: kickoff.getTime(),
    status, shortStatus,
    elapsed: f.fixture?.status?.elapsed || null,
    homeScore: score?.home ?? null,
    awayScore: score?.away ?? null,
    homePct, drawPct, awayPct,
    homeOdds: oddsFromPct(homePct),
    drawOdds: oddsFromPct(drawPct),
    awayOdds: oddsFromPct(awayPct),
  };
}

function getBetOptions(match, typeId) {
  const h = match.home, a = match.away;
  switch (typeId) {
    case "1x2": return [
      { label:`${h} Win`, odds: match.homeOdds },
      { label:"Draw",     odds: match.drawOdds },
      { label:`${a} Win`, odds: match.awayOdds },
    ];
    case "btts": return [
      { label:"Both Score – Yes", odds: 1.75 },
      { label:"Both Score – No",  odds: 2.05 },
    ];
    case "ou25": return [
      { label:"Over 2.5 Goals",  odds: 1.85 },
      { label:"Under 2.5 Goals", odds: 1.95 },
    ];
    case "ou35": return [
      { label:"Over 3.5 Goals",  odds: 2.50 },
      { label:"Under 3.5 Goals", odds: 1.50 },
    ];
    case "dc": return [
      { label:`${h} or Draw`, odds: +(1/((match.homePct+match.drawPct)/100)).toFixed(2) },
      { label:`${a} or Draw`, odds: +(1/((match.awayPct+match.drawPct)/100)).toFixed(2) },
      { label:`${h} or ${a}`, odds: +(1/((match.homePct+match.awayPct)/100)).toFixed(2) },
    ];
    case "ht": return [
      { label:`${h} HT Win`, odds: +(match.homeOdds*1.45).toFixed(2) },
      { label:"HT Draw",     odds: 2.10 },
      { label:`${a} HT Win`, odds: +(match.awayOdds*1.45).toFixed(2) },
    ];
    case "cs": return [
      {label:"1-0",odds:5.5},{label:"2-0",odds:7.0},{label:"2-1",odds:6.5},
      {label:"0-1",odds:7.5},{label:"0-2",odds:9.0},{label:"1-2",odds:8.0},
      {label:"1-1",odds:5.0},{label:"2-2",odds:8.5},{label:"0-0",odds:6.0},
    ];
    case "anytime": return [
      {label:`${h} Top Scorer`,odds:2.80},{label:`${h} Any Scorer`,odds:1.90},
      {label:`${a} Top Scorer`,odds:3.20},{label:`${a} Any Scorer`,odds:2.10},
    ];
    default: return [];
  }
}

// ─── STAT BAR ─────────────────────────────────────────────────────────────────
function StatBar({ label, homeVal, awayVal }) {
  const hv = parseInt(homeVal) || 0;
  const av = parseInt(awayVal) || 0;
  const total = hv + av;
  const hPct = total > 0 ? (hv / total) * 100 : 50;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:4 }}>
        <span style={{ color:"#fff", fontWeight:700 }}>{hv}</span>
        <span style={{ color:"rgba(255,255,255,0.4)" }}>{label}</span>
        <span style={{ color:"#fff", fontWeight:700 }}>{av}</span>
      </div>
      <div style={{ height:5, background:"rgba(255,255,255,0.08)", borderRadius:3, overflow:"hidden" }}>
        {total > 0 && <div style={{ height:"100%", width:`${hPct}%`, background:"linear-gradient(90deg,#e8ff47,#a3e635)", borderRadius:3 }} />}
      </div>
    </div>
  );
}

// ─── PITCH LINEUP ─────────────────────────────────────────────────────────────
function LineupPitch({ homeLineup, awayLineup, homeName, awayName, lc }) {
  const renderRows = (lineup, flip) => {
    if (!lineup?.startXI?.length) return null;
    const formation = lineup.formation || "4-3-3";
    const rows = formation.split("-").map(Number);
    const players = lineup.startXI.map(p => p.player);
    const grouped = [[players[0]], ...rows.map((n, i) => {
      let idx = 1 + rows.slice(0, i).reduce((a,b)=>a+b, 0);
      return players.slice(idx, idx + n);
    })];
    if (flip) grouped.reverse();
    return grouped.map((row, ri) => (
      <div key={ri} style={{ display:"flex", justifyContent:"center", gap:4, marginBottom:8 }}>
        {row.map((p, pi) => (
          <div key={pi} style={{ textAlign:"center", width:44 }}>
            <div style={{ width:28, height:28, borderRadius:"50%", background: flip?"#60a5fa":lc, margin:"0 auto 2px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:800, color:"#000", border:"2px solid rgba(255,255,255,0.25)" }}>
              {p?.number || "?"}
            </div>
            <div style={{ fontSize:8, color:"rgba(255,255,255,0.7)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:44 }}>
              {p?.name?.split(" ").pop()}
            </div>
          </div>
        ))}
      </div>
    ));
  };

  return (
    <div style={{ background:"linear-gradient(180deg,#1a5c1a,#2e7d2e 40%,#2e7d2e 60%,#1a5c1a)", borderRadius:12, padding:"14px 8px", border:"1px solid rgba(255,255,255,0.1)" }}>
      <div style={{ fontSize:10, fontWeight:800, color:lc, textAlign:"center", marginBottom:8 }}>{homeName} · {homeLineup?.formation || "?"}</div>
      {renderRows(homeLineup, false)}
      <div style={{ height:1, background:"rgba(255,255,255,0.2)", margin:"10px 0" }} />
      {renderRows(awayLineup, true)}
      <div style={{ fontSize:10, fontWeight:800, color:"#60a5fa", textAlign:"center", marginTop:8 }}>{awayName} · {awayLineup?.formation || "?"}</div>
    </div>
  );
}

// ─── MATCH MODAL ─────────────────────────────────────────────────────────────
function MatchModal({ match, onClose, onBet, balance }) {
  const [activeTab, setActiveTab] = useState("markets");
  const [selectedType, setSelectedType] = useState("1x2");
  const [selectedOption, setSelectedOption] = useState(null);
  const [betAmt, setBetAmt] = useState("");
  const [lineups, setLineups] = useState(null);
  const [statsData, setStatsData] = useState(null);
  const [loadingTab, setLoadingTab] = useState(false);

  const lc = match.leagueColor || "#e8ff47";
  const options = getBetOptions(match, selectedType);
  const selOdds = selectedOption !== null ? options[selectedOption]?.odds : null;
  const potential = betAmt && selOdds ? Math.round(parseFloat(betAmt) * selOdds * 100) / 100 : 0;
  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const matchStarted = isLive || isFinished;

  useEffect(() => {
    if (activeTab !== "lineups" || lineups) return;
    setLoadingTab(true);
    api(`/fixtures/${match.fixtureId}/lineups`)
      .then(d => setLineups(d.response || []))
      .catch(() => setLineups([]))
      .finally(() => setLoadingTab(false));
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "stats" || statsData) return;
    setLoadingTab(true);
    api(`/fixtures/${match.fixtureId}/stats`)
      .then(d => setStatsData(d))
      .catch(() => setStatsData({ stats: [], events: [] }))
      .finally(() => setLoadingTab(false));
  }, [activeTab]);

  const handlePlace = () => {
    const amt = parseFloat(betAmt);
    if (!amt || amt < 1 || selectedOption === null) return;
    onBet(match, options[selectedOption].label, amt, selOdds, BET_TYPES.find(b => b.id === selectedType)?.label);
    onClose();
  };

  const statVal = (teamIdx, key) => {
    if (!statsData?.stats?.[teamIdx]) return 0;
    return statsData.stats[teamIdx].statistics?.find(s => s.type === key)?.value ?? 0;
  };

  const homeLineup = lineups?.find(l => l.team?.name === match.home);
  const awayLineup = lineups?.find(l => l.team?.name === match.away);

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center" }} onClick={onClose}>
      <div style={{ width:"100%",maxWidth:480,background:"#0e1628",borderRadius:"20px 20px 0 0",maxHeight:"92vh",overflowY:"auto",paddingBottom:32 }} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:"20px 20px 0",background:`linear-gradient(135deg,${lc}18,transparent)`,borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
            <span style={{ fontSize:12,color:lc,fontWeight:800 }}>{getLeague(match.league).flag} {match.league}</span>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              {isLive && <span style={{ fontSize:11,color:"#ef4444",fontWeight:800,animation:"pulse 1s infinite" }}>● LIVE {match.elapsed}'</span>}
              {isFinished && <span style={{ fontSize:11,color:"rgba(255,255,255,0.4)",fontWeight:700 }}>FT</span>}
              <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)",border:"none",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer" }}>✕</button>
            </div>
          </div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",paddingBottom:16 }}>
            <div style={{ textAlign:"center",flex:1 }}>
              {match.homeLogo && <img src={match.homeLogo} alt="" style={{ width:38,height:38,objectFit:"contain",marginBottom:6 }} onError={e=>e.target.style.display="none"} />}
              <div style={{ fontWeight:900,fontSize:15 }}>{match.home}</div>
              <div style={{ fontSize:10,color:"rgba(255,255,255,0.4)",marginTop:2 }}>{match.homePct}% win</div>
            </div>
            <div style={{ textAlign:"center",minWidth:80 }}>
              {matchStarted
                ? <div style={{ fontSize:32,fontWeight:900,letterSpacing:2 }}>{match.homeScore} – {match.awayScore}</div>
                : <><div style={{ fontSize:11,color:lc,fontWeight:800 }}>VS</div><div style={{ fontSize:10,color:"rgba(255,255,255,0.4)",marginTop:3 }}>{match.time}</div></>
              }
            </div>
            <div style={{ textAlign:"center",flex:1 }}>
              {match.awayLogo && <img src={match.awayLogo} alt="" style={{ width:38,height:38,objectFit:"contain",marginBottom:6 }} onError={e=>e.target.style.display="none"} />}
              <div style={{ fontWeight:900,fontSize:15 }}>{match.away}</div>
              <div style={{ fontSize:10,color:"rgba(255,255,255,0.4)",marginTop:2 }}>{match.awayPct}% win</div>
            </div>
          </div>
          <div style={{ display:"flex",gap:4,marginBottom:-1 }}>
            {["markets","lineups","stats"].map(t => (
              <button key={t} onClick={()=>setActiveTab(t)} style={{ padding:"8px 16px",background:"none",border:"none",borderBottom:activeTab===t?`2px solid ${lc}`:"2px solid transparent",color:activeTab===t?"#fff":"rgba(255,255,255,0.4)",cursor:"pointer",fontWeight:700,fontSize:12,textTransform:"capitalize" }}>{t}</button>
            ))}
          </div>
        </div>

        <div style={{ padding:"16px 18px" }}>

          {/* MARKETS */}
          {activeTab === "markets" && (
            <div>
              <div style={{ display:"flex",gap:6,overflowX:"auto",paddingBottom:8,marginBottom:14 }}>
                {BET_TYPES.map(bt => (
                  <button key={bt.id} onClick={()=>{ setSelectedType(bt.id); setSelectedOption(null); }} style={{ padding:"6px 12px",borderRadius:20,whiteSpace:"nowrap",border:selectedType===bt.id?`1px solid ${lc}`:"1px solid rgba(255,255,255,0.1)",background:selectedType===bt.id?`${lc}22`:"rgba(255,255,255,0.04)",color:selectedType===bt.id?lc:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:11,fontWeight:700 }}>{bt.label}</button>
                ))}
              </div>
              <div style={{ display:"grid",gridTemplateColumns:options.length>3?"1fr 1fr 1fr":`repeat(${options.length},1fr)`,gap:8,marginBottom:16 }}>
                {options.map((opt,i) => (
                  <button key={i} onClick={()=>setSelectedOption(i)} style={{ padding:"10px 6px",borderRadius:10,textAlign:"center",cursor:"pointer",border:selectedOption===i?`2px solid ${lc}`:"2px solid rgba(255,255,255,0.07)",background:selectedOption===i?`${lc}18`:"rgba(255,255,255,0.04)",color:selectedOption===i?"#fff":"rgba(255,255,255,0.7)" }}>
                    <div style={{ fontSize:9,opacity:0.6,marginBottom:4 }}>{opt.label}</div>
                    <div style={{ fontSize:18,fontWeight:900,color:selectedOption===i?lc:"#fff" }}>{opt.odds}x</div>
                  </button>
                ))}
              </div>
              {selectedOption !== null && (
                <div style={{ padding:14,background:"rgba(255,255,255,0.04)",borderRadius:12,border:`1px solid ${lc}33` }}>
                  <div style={{ fontSize:12,color:"rgba(255,255,255,0.5)",marginBottom:10 }}>
                    <span style={{ color:lc,fontWeight:700 }}>{options[selectedOption].label}</span> @ <span style={{ color:lc,fontWeight:700 }}>{selOdds}x</span>
                  </div>
                  <div style={{ display:"flex",gap:6,marginBottom:8 }}>
                    {[10,25,50].map(q => (
                      <button key={q} onClick={()=>setBetAmt(String(Math.min(q,balance)))} style={{ padding:"5px 12px",borderRadius:6,border:`1px solid ${lc}33`,background:`${lc}11`,color:lc,cursor:"pointer",fontSize:12,fontWeight:700 }}>${q}</button>
                    ))}
                    <button onClick={()=>setBetAmt(String(balance))} style={{ padding:"5px 12px",borderRadius:6,border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.06)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700 }}>All-in</button>
                  </div>
                  <div style={{ display:"flex",gap:8 }}>
                    <input value={betAmt} onChange={e=>setBetAmt(e.target.value)} type="number" placeholder="Amount..." style={{ flex:1,padding:"10px 14px",borderRadius:8,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"#fff",fontSize:14,outline:"none" }} />
                    <button onClick={handlePlace} disabled={!betAmt||parseFloat(betAmt)<1} style={{ padding:"10px 20px",background:lc,color:"#0a0f1e",border:"none",borderRadius:8,fontWeight:900,cursor:"pointer",fontSize:14,opacity:(!betAmt||parseFloat(betAmt)<1)?0.4:1 }}>BET</button>
                  </div>
                  {potential>0 && <div style={{ marginTop:8,fontSize:12,color:"rgba(255,255,255,0.4)" }}>Potential return: <span style={{ color:"#4ade80",fontWeight:700 }}>{fmt(potential)}</span></div>}
                </div>
              )}
            </div>
          )}

          {/* LINEUPS */}
          {activeTab === "lineups" && (
            loadingTab ? <Loader /> :
            lineups?.length > 0 ? (
              <>
                <LineupPitch homeLineup={homeLineup} awayLineup={awayLineup} homeName={match.home} awayName={match.away} lc={lc} />
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:14 }}>
                  {[{l:homeLineup,n:match.home,c:lc},{l:awayLineup,n:match.away,c:"#60a5fa"}].map((t,ti)=>(
                    <div key={ti}>
                      <div style={{ fontSize:11,fontWeight:800,color:t.c,marginBottom:8 }}>{t.n} · {t.l?.formation||"?"}</div>
                      {(t.l?.startXI||[]).map((p,i)=>(
                        <div key={i} style={{ fontSize:11,color:"rgba(255,255,255,0.75)",padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,0.05)",display:"flex",gap:8 }}>
                          <span style={{ color:"rgba(255,255,255,0.25)",minWidth:16,fontWeight:700 }}>{p.player?.number}</span>
                          <span>{p.player?.name}</span>
                        </div>
                      ))}
                      {(t.l?.substitutes||[]).length>0&&<div style={{ marginTop:8,fontSize:10,color:"rgba(255,255,255,0.3)",fontWeight:700,marginBottom:4 }}>SUBS</div>}
                      {(t.l?.substitutes||[]).map((p,i)=>(
                        <div key={i} style={{ fontSize:10,color:"rgba(255,255,255,0.35)",padding:"3px 0",display:"flex",gap:8 }}>
                          <span style={{ color:"rgba(255,255,255,0.2)",minWidth:16 }}>{p.player?.number}</span>
                          <span>{p.player?.name}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState icon="📋" title="Lineup not confirmed yet" subtitle="Official lineups are released ~60 minutes before kick-off" />
            )
          )}

          {/* STATS */}
          {activeTab === "stats" && (
            loadingTab ? <Loader /> :
            !matchStarted ? (
              <EmptyState icon="⏰" title="Match hasn't started yet" subtitle={`Live stats will appear here once the match kicks off · ${match.time}`} />
            ) : (
              <>
                {(statsData?.events||[]).filter(e=>e.type==="Goal").length>0&&(
                  <div style={{ marginBottom:16 }}>
                    <div style={{ fontSize:11,fontWeight:800,color:"rgba(255,255,255,0.4)",marginBottom:8,letterSpacing:1 }}>GOALS</div>
                    {statsData.events.filter(e=>e.type==="Goal").map((e,i)=>(
                      <div key={i} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                        <span style={{ fontSize:12,color:"#fbbf24" }}>⚽</span>
                        <span style={{ fontSize:12,fontWeight:700 }}>{e.player?.name}</span>
                        <span style={{ fontSize:11,color:"rgba(255,255,255,0.4)" }}>{e.team?.name}</span>
                        <span style={{ marginLeft:"auto",fontSize:11,color:"#e8ff47",fontWeight:700 }}>{e.time?.elapsed}'</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:12 }}>
                  <span style={{ fontSize:12,fontWeight:700,color:lc }}>{match.home}</span>
                  <span style={{ fontSize:10,color:"rgba(255,255,255,0.3)" }}>{isLive?`LIVE ${match.elapsed}'`:"FT"}</span>
                  <span style={{ fontSize:12,fontWeight:700,color:"#60a5fa" }}>{match.away}</span>
                </div>
                {statsData?.stats?.length>0 ? (
                  <>
                    <StatBar label="Possession %" homeVal={parseInt(statVal(0,"Ball Possession"))||0} awayVal={parseInt(statVal(1,"Ball Possession"))||0} />
                    <StatBar label="Total Shots" homeVal={statVal(0,"Total Shots")} awayVal={statVal(1,"Total Shots")} />
                    <StatBar label="Shots on Target" homeVal={statVal(0,"Shots on Target")} awayVal={statVal(1,"Shots on Target")} />
                    <StatBar label="Corner Kicks" homeVal={statVal(0,"Corner Kicks")} awayVal={statVal(1,"Corner Kicks")} />
                    <StatBar label="Fouls" homeVal={statVal(0,"Fouls")} awayVal={statVal(1,"Fouls")} />
                    <StatBar label="Yellow Cards" homeVal={statVal(0,"Yellow Cards")} awayVal={statVal(1,"Yellow Cards")} />
                    <StatBar label="Total Passes" homeVal={statVal(0,"Total passes")} awayVal={statVal(1,"Total passes")} />
                    <StatBar label="Pass Accuracy %" homeVal={parseInt(statVal(0,"Passes %"))||0} awayVal={parseInt(statVal(1,"Passes %"))||0} />
                    <StatBar label="Offsides" homeVal={statVal(0,"Offsides")} awayVal={statVal(1,"Offsides")} />
                  </>
                ) : <div style={{ textAlign:"center",padding:"20px",color:"rgba(255,255,255,0.3)",fontSize:12 }}>Stats not available yet</div>}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────────
function Loader() {
  return (
    <div style={{ textAlign:"center",padding:"40px 0",color:"rgba(255,255,255,0.3)" }}>
      <div style={{ width:28,height:28,border:"3px solid rgba(255,255,255,0.1)",borderTop:"3px solid #e8ff47",borderRadius:"50%",margin:"0 auto 12px",animation:"spin 0.8s linear infinite" }} />
      Loading...
    </div>
  );
}

function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={{ textAlign:"center",padding:"48px 20px" }}>
      <div style={{ fontSize:40,marginBottom:12 }}>{icon}</div>
      <div style={{ fontWeight:700,color:"rgba(255,255,255,0.6)",marginBottom:6 }}>{title}</div>
      <div style={{ fontSize:12,color:"rgba(255,255,255,0.3)",lineHeight:1.6 }}>{subtitle}</div>
    </div>
  );
}

// ─── AUTH SCREEN ─────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!username.trim() || !password.trim()) { setError("Fill in all fields"); return; }
    setLoading(true); setError("");
    try {
      const data = await api(`/auth/${mode}`, { method:"POST", body:{ username, password } });
      localStorage.setItem("bp_token", data.token);
      onLogin(data.user);
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const iStyle = { width:"100%",padding:"12px 16px",borderRadius:10,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"#fff",fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:12 };

  return (
    <div style={{ minHeight:"100vh",background:"#080d1a",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Trebuchet MS',sans-serif" }}>
      <div style={{ marginBottom:32,textAlign:"center" }}>
        <div style={{ fontSize:44,fontWeight:900,letterSpacing:-2,color:"#fff" }}>BET<span style={{ color:"#e8ff47" }}>PLAY</span></div>
        <div style={{ fontSize:13,color:"rgba(255,255,255,0.35)",marginTop:6 }}>⚽ Fantasy Betting · No Real Money</div>
      </div>
      <div style={{ width:"100%",maxWidth:360,background:"rgba(255,255,255,0.04)",borderRadius:20,padding:28,border:"1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display:"flex",gap:6,marginBottom:24,background:"rgba(255,255,255,0.04)",borderRadius:10,padding:4 }}>
          {["login","signup"].map(m=>(
            <button key={m} onClick={()=>{ setMode(m); setError(""); }} style={{ flex:1,padding:"8px",background:mode===m?"#e8ff47":"none",color:mode===m?"#080d1a":"rgba(255,255,255,0.5)",border:"none",borderRadius:8,cursor:"pointer",fontWeight:800,fontSize:13 }}>
              {m==="login"?"Log In":"Sign Up"}
            </button>
          ))}
        </div>
        <input style={iStyle} placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} />
        <input style={iStyle} type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handle()} />
        {error && <div style={{ color:"#f87171",fontSize:12,marginBottom:10 }}>⚠️ {error}</div>}
        <button onClick={handle} disabled={loading} style={{ width:"100%",padding:"13px",background:"#e8ff47",color:"#080d1a",border:"none",borderRadius:10,fontWeight:900,fontSize:15,cursor:"pointer",opacity:loading?0.6:1 }}>
          {loading ? "..." : mode==="login" ? "Log In" : "Create Account"}
        </button>
        {mode==="signup"&&<div style={{ marginTop:14,fontSize:11,color:"rgba(255,255,255,0.3)",textAlign:"center" }}>🎁 Start with <strong style={{ color:"#e8ff47" }}>$100.00</strong> in free coins</div>}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("matches");
  const [leagueFilter, setLeagueFilter] = useState("All");
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [adCooldown, setAdCooldown] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const refreshRef = useRef(null);

  // Auto-login from token
  useEffect(() => {
    const token = localStorage.getItem("bp_token");
    if (!token) return;
    api("/me").then(data => setUser(data)).catch(() => localStorage.removeItem("bp_token"));
  }, []);

  // Ad cooldown
  useEffect(() => {
    if (adCooldown <= 0) return;
    const t = setTimeout(() => setAdCooldown(c=>c-1), 1000);
    return () => clearTimeout(t);
  }, [adCooldown]);

  const showToast = useCallback((msg, color="#e8ff47") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Fetch fixtures
  const fetchMatches = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api("/fixtures");
      const parsed = (data.response || []).map(f => {
        const leagueInfo = LEAGUES.find(l => l.id === f.league?.id) || {};
        return parseFixture({ ...f, _leagueInfo: leagueInfo });
      });
      parsed.sort((a,b) => {
        const o = {live:0,upcoming:1,finished:2};
        if (o[a.status]!==o[b.status]) return o[a.status]-o[b.status];
        return a.kickoffTs-b.kickoffTs;
      });
      setMatches(parsed);
    } catch(e) {
      setError("Could not load matches: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch leaderboard
  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await api("/leaderboard");
      setLeaderboard(data);
    } catch(_) {}
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchMatches();
    fetchLeaderboard();
    refreshRef.current = setInterval(fetchMatches, 30000);
    return () => clearInterval(refreshRef.current);
  }, [user]);

  const handleBet = async (match, optionLabel, amount, odds, market) => {
    try {
      const data = await api("/bet", {
        method: "POST",
        body: {
          fixtureId: match.fixtureId,
          matchLabel: `${match.home} vs ${match.away}`,
          league: match.league,
          optionLabel, market, amount, odds,
          potential: Math.round(amount * odds * 100) / 100,
          matchTime: match.time,
        }
      });
      setUser(u => ({ ...u, balance: data.balance, bets: [...(u.bets||[]), data.bet] }));
      showToast(`✅ Bet placed! ${fmt(amount)} on ${optionLabel} @ ${odds}x`);
    } catch(e) {
      showToast(e.message, "#f87171");
    }
  };

  const watchAd = async () => {
    if (adCooldown > 0) return;
    setAdCooldown(30);
    try {
      const data = await api("/adreward", { method:"POST" });
      setUser(u => ({ ...u, balance: data.balance }));
      showToast("📺 Ad watched! +$10 added 🎉", "#4ade80");
    } catch(e) {
      showToast(e.message, "#f87171");
    }
  };

  const logout = () => {
    localStorage.removeItem("bp_token");
    setUser(null); setMatches([]);
  };

  if (!user) return <AuthScreen onLogin={u => setUser(u)} />;

  const bets = user.bets || [];
  const wonBets = bets.filter(b=>b.status==="won");
  const pendingBets = bets.filter(b=>b.status==="pending");
  const settledBets = bets.filter(b=>b.status!=="pending");
  const winRate = settledBets.length > 0 ? Math.round(wonBets.length/settledBets.length*100) : 0;
  const totalWagered = bets.reduce((s,b)=>s+b.amount,0);
  const totalWon = wonBets.reduce((s,b)=>s+b.potential,0);
  const liveCount = matches.filter(m=>m.status==="live").length;

  const filteredMatches = leagueFilter==="All" ? matches : matches.filter(m=>m.league===leagueFilter);

  const tabBtn = (t, label) => (
    <button onClick={()=>setTab(t)} style={{ flex:1,padding:"9px 0",background:tab===t?"#e8ff47":"transparent",color:tab===t?"#080d1a":"rgba(255,255,255,0.45)",border:"none",cursor:"pointer",fontWeight:800,fontSize:11,borderRadius:9,transition:"all 0.2s" }}>{label}</button>
  );

  return (
    <div style={{ minHeight:"100vh",background:"#080d1a",fontFamily:"'Trebuchet MS',sans-serif",color:"#fff",maxWidth:480,margin:"0 auto" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes toastIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
        input[type=number]{-moz-appearance:textfield}
        ::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:4px}
      `}</style>

      {/* HEADER */}
      <div style={{ padding:"16px 16px 0",borderBottom:"1px solid rgba(255,255,255,0.07)",position:"sticky",top:0,background:"rgba(8,13,26,0.97)",backdropFilter:"blur(20px)",zIndex:100 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <span style={{ fontSize:20,fontWeight:900,letterSpacing:-1 }}>BET<span style={{ color:"#e8ff47" }}>PLAY</span></span>
              {liveCount>0&&<span style={{ fontSize:10,background:"#ef4444",color:"#fff",borderRadius:6,padding:"2px 6px",fontWeight:800,animation:"pulse 1.5s infinite" }}>● {liveCount} LIVE</span>}
            </div>
            <div style={{ fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:1 }}>👋 {user.username}</div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:10,color:"rgba(255,255,255,0.35)" }}>Balance</div>
              <div style={{ fontSize:20,fontWeight:900,color:"#e8ff47" }}>{fmt(user.balance)}</div>
            </div>
            <button onClick={logout} style={{ background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:11 }}>Exit</button>
          </div>
        </div>
        <button onClick={watchAd} disabled={adCooldown>0} style={{ width:"100%",marginTop:10,padding:"9px",background:adCooldown>0?"rgba(255,255,255,0.03)":"rgba(74,222,128,0.1)",border:adCooldown>0?"1px solid rgba(255,255,255,0.06)":"1px solid rgba(74,222,128,0.25)",borderRadius:9,color:adCooldown>0?"rgba(255,255,255,0.2)":"#4ade80",cursor:adCooldown>0?"not-allowed":"pointer",fontWeight:700,fontSize:12 }}>
          {adCooldown>0?`⏳ Next +$10 in ${adCooldown}s`:"📺 Watch Ad · Get $10 FREE"}
        </button>
        <div style={{ display:"flex",gap:4,marginTop:10,background:"rgba(255,255,255,0.04)",borderRadius:11,padding:3 }}>
          {tabBtn("matches","⚽ Matches")}
          {tabBtn("mybets",`🎯 Bets${pendingBets.length>0?` (${pendingBets.length})`:""}`)}
          {tabBtn("leaderboard","🏆 Ranks")}
          {tabBtn("profile","👤 Profile")}
        </div>
      </div>

      <div style={{ padding:"14px 14px 80px" }}>

        {/* MATCHES */}
        {tab==="matches"&&(
          <div>
            <div style={{ display:"flex",gap:6,overflowX:"auto",paddingBottom:10,marginBottom:12 }}>
              {["All",...LEAGUES.map(l=>l.name)].map(l=>{
                const info = LEAGUES.find(x=>x.name===l)||{};
                const lc2 = info.color||"#e8ff47";
                const active = leagueFilter===l;
                return <button key={l} onClick={()=>setLeagueFilter(l)} style={{ padding:"5px 12px",borderRadius:20,whiteSpace:"nowrap",border:active?`1px solid ${lc2}`:"1px solid rgba(255,255,255,0.1)",background:active?`${lc2}22`:"rgba(255,255,255,0.04)",color:active?lc2:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:11,fontWeight:700 }}>{info.flag?`${info.flag} `:""}{l}</button>;
              })}
            </div>
            {error&&<div style={{ padding:"12px 16px",background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:12,marginBottom:12,fontSize:12,color:"#f87171" }}>⚠️ {error} <button onClick={fetchMatches} style={{ marginLeft:8,background:"none",border:"1px solid #f87171",color:"#f87171",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:11 }}>Retry</button></div>}
            {loading&&<Loader />}
            {!loading&&filteredMatches.map(m=>{
              const lc2 = m.leagueColor||"#e8ff47";
              const isLive = m.status==="live";
              const isFinished = m.status==="finished";
              return (
                <div key={m.id} onClick={()=>setSelectedMatch(m)} style={{ background:"rgba(255,255,255,0.04)",borderRadius:14,padding:"14px 16px",marginBottom:10,cursor:"pointer",animation:"slideUp 0.25s ease",border:isLive?`1px solid ${lc2}55`:"1px solid rgba(255,255,255,0.07)",borderLeft:`3px solid ${lc2}`,boxShadow:isLive?`0 0 12px ${lc2}15`:"none" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                    <span style={{ fontSize:10,color:lc2,fontWeight:800 }}>{getLeague(m.league).flag} {m.league}</span>
                    <span style={{ fontSize:10,fontWeight:700,color:isLive?"#ef4444":isFinished?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.35)" }}>{isLive?`● LIVE ${m.elapsed}'`:isFinished?"FT":m.time}</span>
                  </div>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8,flex:1 }}>
                      {m.homeLogo&&<img src={m.homeLogo} alt="" style={{ width:22,height:22,objectFit:"contain" }} onError={e=>e.target.style.display="none"} />}
                      <span style={{ fontWeight:800,fontSize:14 }}>{m.home}</span>
                    </div>
                    {(isLive||isFinished)
                      ?<div style={{ textAlign:"center",minWidth:60,fontSize:22,fontWeight:900,letterSpacing:2 }}>{m.homeScore} – {m.awayScore}</div>
                      :<div style={{ fontSize:10,color:"rgba(255,255,255,0.25)",padding:"3px 10px",background:"rgba(255,255,255,0.04)",borderRadius:6 }}>VS</div>
                    }
                    <div style={{ display:"flex",alignItems:"center",gap:8,flex:1,justifyContent:"flex-end" }}>
                      <span style={{ fontWeight:800,fontSize:14 }}>{m.away}</span>
                      {m.awayLogo&&<img src={m.awayLogo} alt="" style={{ width:22,height:22,objectFit:"contain" }} onError={e=>e.target.style.display="none"} />}
                    </div>
                  </div>
                  {!isFinished&&(
                    <div style={{ display:"flex",gap:6 }}>
                      {[{l:m.home,o:m.homeOdds},{l:"Draw",o:m.drawOdds},{l:m.away,o:m.awayOdds}].map((opt,i)=>(
                        <div key={i} style={{ flex:1,padding:"7px 4px",background:"rgba(255,255,255,0.05)",borderRadius:8,border:"1px solid rgba(255,255,255,0.07)",textAlign:"center" }}>
                          <div style={{ fontSize:9,color:"rgba(255,255,255,0.4)",marginBottom:2 }}>{opt.l}</div>
                          <div style={{ fontSize:15,fontWeight:900 }}>{opt.o}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop:8,fontSize:9,color:"rgba(255,255,255,0.2)",textAlign:"right" }}>Tap for all markets →</div>
                </div>
              );
            })}
            {!loading&&!error&&filteredMatches.length===0&&<EmptyState icon="📭" title="No upcoming matches found" subtitle="Try a different league or check back soon" />}
          </div>
        )}

        {/* MY BETS */}
        {tab==="mybets"&&(
          bets.length===0
            ?<EmptyState icon="🎯" title="No bets placed yet" subtitle="Head to Matches and place your first bet" />
            :[...bets].reverse().map(b=>{
              const lc2 = getLeague(b.league)?.color||"#e8ff47";
              const sc = b.status==="won"?"#4ade80":b.status==="lost"?"#f87171":"#fbbf24";
              return (
                <div key={b.id} style={{ background:"rgba(255,255,255,0.04)",borderLeft:`3px solid ${lc2}`,border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"14px 16px",marginBottom:10 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10,color:lc2,fontWeight:700,marginBottom:4 }}>{getLeague(b.league)?.flag} {b.league}</div>
                      <div style={{ fontSize:12,color:"rgba(255,255,255,0.5)",marginBottom:3 }}>{b.match_label}</div>
                      <div style={{ fontWeight:800,fontSize:15 }}>{b.option_label}</div>
                      <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:3 }}>{b.market} · {b.match_time}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:10,color:"rgba(255,255,255,0.35)" }}>Staked</div>
                      <div style={{ fontWeight:700,color:"#f87171" }}>{fmt(b.amount)}</div>
                      <div style={{ fontSize:11,color:"#4ade80",marginTop:4 }}>Win: {fmt(b.potential)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop:10,display:"flex",gap:6 }}>
                    <span style={{ fontSize:10,padding:"3px 10px",background:`${lc2}18`,color:lc2,borderRadius:6,fontWeight:700 }}>{b.odds}x</span>
                    <span style={{ fontSize:10,padding:"3px 10px",background:`${sc}18`,color:sc,borderRadius:6,fontWeight:700 }}>{b.status==="pending"?"⏳ Pending":b.status==="won"?"✅ Won":"❌ Lost"}</span>
                  </div>
                </div>
              );
            })
        )}

        {/* LEADERBOARD */}
        {tab==="leaderboard"&&(
          <div>
            <div style={{ fontSize:11,color:"rgba(255,255,255,0.3)",marginBottom:14,letterSpacing:1,textTransform:"uppercase" }}>Global Rankings</div>
            {leaderboard.map((p,i)=>{
              const badges = ["🏆","🥈","🥉","⭐","⭐"];
              const isMe = p.username===user.username;
              return (
                <div key={p.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"14px 16px",marginBottom:8,background:isMe?"rgba(232,255,71,0.06)":"rgba(255,255,255,0.04)",border:isMe?"1px solid rgba(232,255,71,0.2)":"1px solid rgba(255,255,255,0.07)",borderRadius:14 }}>
                  <div style={{ fontSize:22,width:36,textAlign:"center" }}>{badges[i]||"👤"}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800,fontSize:14,color:isMe?"#e8ff47":"#fff" }}>{p.username}{isMe&&<span style={{ fontSize:10,opacity:0.5 }}> (you)</span>}</div>
                    <div style={{ fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:2 }}>Rank #{i+1} · {p.wins||0}/{p.total_bets||0} wins</div>
                  </div>
                  <div style={{ fontWeight:900,fontSize:17,color:isMe?"#e8ff47":"#fff" }}>{fmt(p.balance)}</div>
                </div>
              );
            })}
            <div style={{ marginTop:16,padding:14,background:"rgba(255,255,255,0.03)",borderRadius:12,textAlign:"center",fontSize:12,color:"rgba(255,255,255,0.35)",lineHeight:1.8 }}>
              🌍 Invite friends to compete!<br/><span style={{ color:"#e8ff47" }}>Whoever ends the week with most coins wins</span>
            </div>
          </div>
        )}

        {/* PROFILE */}
        {tab==="profile"&&(
          <div>
            <div style={{ background:"linear-gradient(135deg,rgba(232,255,71,0.08),rgba(232,255,71,0.03))",border:"1px solid rgba(232,255,71,0.15)",borderRadius:16,padding:20,marginBottom:16 }}>
              <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:16 }}>
                <div style={{ width:52,height:52,borderRadius:"50%",background:"linear-gradient(135deg,#e8ff47,#a3e635)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:900,color:"#080d1a" }}>{user.username[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight:900,fontSize:18 }}>{user.username}</div>
                  <div style={{ fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:2 }}>Joined {new Date(user.joined).toLocaleDateString("en-GB",{month:"short",year:"numeric"})}</div>
                </div>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                {[
                  {label:"Balance",    val:fmt(user.balance),  color:"#e8ff47"},
                  {label:"Win Rate",   val:`${winRate}%`,      color:winRate>=50?"#4ade80":"#f87171"},
                  {label:"Total Bets", val:bets.length,        color:"#60a5fa"},
                  {label:"Wagered",    val:fmt(totalWagered),  color:"#f87171"},
                  {label:"Bets Won",   val:wonBets.length,     color:"#4ade80"},
                  {label:"Pending",    val:pendingBets.length, color:"#fbbf24"},
                ].map((s,i)=>(
                  <div key={i} style={{ background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"12px 14px" }}>
                    <div style={{ fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:4 }}>{s.label}</div>
                    <div style={{ fontSize:20,fontWeight:900,color:s.color }}>{s.val}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:16,marginBottom:16 }}>
              <div style={{ fontWeight:800,fontSize:14,marginBottom:12 }}>📊 Profit / Loss</div>
              {[{l:"Total wagered",v:fmt(totalWagered),c:"#fff"},{l:"Total won",v:fmt(totalWon),c:"#4ade80"},{l:"Net P/L",v:fmt(totalWon-totalWagered),c:totalWon-totalWagered>=0?"#4ade80":"#f87171"}].map((s,i)=>(
                <div key={i} style={{ fontSize:13,color:"rgba(255,255,255,0.5)",marginBottom:6 }}>{s.l}: <span style={{ color:s.c,fontWeight:700 }}>{s.v}</span></div>
              ))}
            </div>
            {bets.length>0&&(()=>{
              const counts = bets.reduce((a,b)=>{a[b.league]=(a[b.league]||0)+1;return a},{});
              const fav = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
              const info = getLeague(fav[0]);
              return <div style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:16,marginBottom:16 }}>
                <div style={{ fontWeight:800,fontSize:14,marginBottom:8 }}>🏆 Favourite League</div>
                <div style={{ fontSize:15,fontWeight:700,color:info.color||"#e8ff47" }}>{info.flag} {fav[0]} <span style={{ fontSize:11,color:"rgba(255,255,255,0.4)" }}>({fav[1]} bets)</span></div>
              </div>;
            })()}
            <button onClick={logout} style={{ width:"100%",padding:13,background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.25)",color:"#f87171",borderRadius:12,fontWeight:800,cursor:"pointer",fontSize:14 }}>← Log Out</button>
          </div>
        )}
      </div>

      {selectedMatch&&<MatchModal match={selectedMatch} onClose={()=>setSelectedMatch(null)} onBet={handleBet} balance={user.balance} />}

      {toast&&<div style={{ position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#111827",border:`1px solid ${toast.color}40`,color:toast.color,padding:"11px 18px",borderRadius:12,fontWeight:700,fontSize:13,zIndex:300,whiteSpace:"nowrap",boxShadow:"0 8px 32px rgba(0,0,0,0.6)",animation:"toastIn 0.3s ease" }}>{toast.msg}</div>}
    </div>
  );
}
