import { useState, useEffect, useCallback, useRef } from "react";

const BET_TYPES = [
  { id:"1x2", label:"Match Result" },
  { id:"btts", label:"Both Teams Score" },
  { id:"ou25", label:"Over/Under 2.5" },
  { id:"ou35", label:"Over/Under 3.5" },
  { id:"dc",   label:"Double Chance" },
  { id:"ht",   label:"Half-Time Result" },
  { id:"cs",   label:"Correct Score" },
  { id:"ag",   label:"Anytime Scorer" },
];

// ─── API ──────────────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem("bp_token"); }
async function api(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt = n => "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const oddsFromPct = p => Math.max(1.05, Math.round((100 / Math.max(p, 1)) * 100) / 100);
const lcol = id => {
  const MAP = {39:"#3b82f6",140:"#ef4444",78:"#f59e0b",135:"#10b981",61:"#8b5cf6",2:"#fbbf24",3:"#f97316",848:"#06b6d4",45:"#60a5fa",48:"#a78bfa",88:"#f43f5e",94:"#22c55e",71:"#84cc16",73:"#fb923c",253:"#14b8a6",262:"#f87171",98:"#34d399",103:"#c084fc",179:"#38bdf8",144:"#e879f9"};
  return MAP[id] || "#" + ((id * 2654435761) & 0xFFFFFF).toString(16).padStart(6,"0").slice(0,6);
};

function parseFixture(f) {
  // football-data.org already parses matches server-side, so f is our own format
  // Just pass through with defaults for any missing fields
  return {
    id: f.id,
    fixtureId: f.fixtureId || f.id,
    league: f.league || "Unknown",
    leagueId: f.leagueId,
    leagueColor: f.leagueColor || lcol(f.leagueId) || "#e8ff47",
    leagueLogo: f.leagueLogo || null,
    leagueCountry: f.leagueCountry || "",
    home: f.home || "TBA",
    away: f.away || "TBA",
    homeLogo: f.homeLogo || null,
    awayLogo: f.awayLogo || null,
    time: f.time || "",
    kickoffTs: f.kickoffTs || 0,
    status: f.status || "upcoming",
    elapsed: f.elapsed || null,
    homeScore: f.homeScore ?? null,
    awayScore: f.awayScore ?? null,
    homeOdds: f.homeOdds || 2.50,
    drawOdds: f.drawOdds || 3.20,
    awayOdds: f.awayOdds || 2.80,
  };
}

function getBetOptions(m, t) {
  switch(t) {
    case "1x2": return [{label:`${m.home}`,odds:m.homeOdds},{label:"Draw",odds:m.drawOdds},{label:`${m.away}`,odds:m.awayOdds}];
    case "btts": return [{label:"Yes",odds:1.75},{label:"No",odds:2.05}];
    case "ou25": return [{label:"Over 2.5",odds:1.85},{label:"Under 2.5",odds:1.95}];
    case "ou35": return [{label:"Over 3.5",odds:2.50},{label:"Under 3.5",odds:1.50}];
    case "dc":   return [{label:`${m.home}/Draw`,odds:1.30},{label:`${m.away}/Draw`,odds:1.40},{label:`${m.home}/${m.away}`,odds:1.20}];
    case "ht":   return [{label:`${m.home} HT`,odds:+(m.homeOdds*1.4).toFixed(2)},{label:"HT Draw",odds:2.10},{label:`${m.away} HT`,odds:+(m.awayOdds*1.4).toFixed(2)}];
    case "cs":   return [{label:"1-0",odds:5.5},{label:"2-0",odds:7.0},{label:"2-1",odds:6.5},{label:"0-1",odds:7.5},{label:"0-2",odds:9.0},{label:"1-1",odds:5.0},{label:"2-2",odds:8.5},{label:"0-0",odds:6.0}];
    case "ag":   return [{label:`${m.home} scorer`,odds:1.90},{label:`${m.away} scorer`,odds:2.10}];
    default: return [];
  }
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function Loader({ small }) {
  return <div style={{ textAlign:"center", padding: small?"10px 0":"40px 0", color:"rgba(255,255,255,0.3)" }}>
    <div style={{ width:small?18:28, height:small?18:28, border:`${small?2:3}px solid rgba(255,255,255,0.1)`, borderTop:`${small?2:3}px solid #e8ff47`, borderRadius:"50%", margin:"0 auto 8px", animation:"spin 0.8s linear infinite" }}/>
    {!small && "Loading..."}
  </div>;
}

function Empty({ icon, title, sub }) {
  return <div style={{ textAlign:"center", padding:"40px 16px" }}>
    <div style={{ fontSize:36, marginBottom:10 }}>{icon}</div>
    <div style={{ fontWeight:700, color:"rgba(255,255,255,0.55)", marginBottom:6 }}>{title}</div>
    {sub && <div style={{ fontSize:12, color:"rgba(255,255,255,0.28)", lineHeight:1.6 }}>{sub}</div>}
  </div>;
}

function StatBar({ label, a, b }) {
  const na=parseInt(a)||0, nb=parseInt(b)||0, tot=na+nb;
  const pct = tot > 0 ? (na/tot)*100 : 50;
  return <div style={{ marginBottom:10 }}>
    <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
      <b style={{ color:"#fff" }}>{na}</b>
      <span style={{ color:"rgba(255,255,255,0.35)" }}>{label}</span>
      <b style={{ color:"#fff" }}>{nb}</b>
    </div>
    <div style={{ height:4, background:"rgba(255,255,255,0.07)", borderRadius:2, overflow:"hidden" }}>
      <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg,#e8ff47,#a3e635)", borderRadius:2 }}/>
    </div>
  </div>;
}

function MatchModal({ match: m, onClose, onBet, balance, favMatches, onToggleFavMatch }) {
  const [tab, setTab] = useState("markets");
  const [betType, setBetType] = useState("1x2");
  const [selOpt, setSelOpt] = useState(null);
  const [amt, setAmt] = useState("");
  const [lineups, setLineups] = useState(null);
  const [stats, setStats] = useState(null);
  const [tabLoading, setTabLoading] = useState(false);
  const lc = m.leagueColor;
  const opts = getBetOptions(m, betType);
  const selOdds = selOpt !== null ? opts[selOpt]?.odds : null;
  const potential = amt && selOdds ? Math.round(parseFloat(amt) * selOdds * 100) / 100 : 0;
  const isLive = m.status === "live", isFT = m.status === "finished";
  const isFav = favMatches.has(m.id);

  useEffect(() => {
    if (tab !== "lineups" || lineups) return;
    setTabLoading(true);
    api(`/fixtures/${m.fixtureId}/lineups`).then(d => setLineups(d.response||[])).catch(()=>setLineups([])).finally(()=>setTabLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== "stats" || stats) return;
    setTabLoading(true);
    api(`/fixtures/${m.fixtureId}/stats`).then(d => setStats(d)).catch(()=>setStats({stats:[],events:[]})).finally(()=>setTabLoading(false));
  }, [tab]);

  const sv = (ti, key) => stats?.stats?.[ti]?.statistics?.find(s => s.type===key)?.value ?? 0;

  const doPlace = () => {
    const a = parseFloat(amt);
    if (!a || a < 1 || selOpt === null) return;
    onBet(m, opts[selOpt].label, a, selOdds, BET_TYPES.find(b=>b.id===betType)?.label);
    onClose();
  };

  const hl = lineups?.find(l => l.team?.name === m.home);
  const al = lineups?.find(l => l.team?.name === m.away);

  const renderPitch = (lineup, flip) => {
    if (!lineup?.startXI?.length) return null;
    const rows = (lineup.formation||"4-3-3").split("-").map(Number);
    const players = lineup.startXI.map(p=>p.player);
    const grouped = [[players[0]], ...rows.map((n,i)=>{ let idx=1+rows.slice(0,i).reduce((a,b)=>a+b,0); return players.slice(idx,idx+n); })];
    if (flip) grouped.reverse();
    return grouped.map((row, ri) => (
      <div key={ri} style={{ display:"flex", justifyContent:"center", gap:4, marginBottom:8 }}>
        {row.map((p,pi) => (
          <div key={pi} style={{ textAlign:"center", width:44 }}>
            <div style={{ width:26,height:26,borderRadius:"50%",background:flip?"#60a5fa":lc,margin:"0 auto 2px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:"#000" }}>{p?.number||"?"}</div>
            <div style={{ fontSize:7.5, color:"rgba(255,255,255,0.65)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:44 }}>{p?.name?.split(" ").pop()}</div>
          </div>
        ))}
      </div>
    ));
  };

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center" }} onClick={onClose}>
      <div style={{ width:"100%",maxWidth:480,background:"#0b1120",borderRadius:"22px 22px 0 0",maxHeight:"94vh",overflowY:"auto",paddingBottom:36 }} onClick={e=>e.stopPropagation()}>

        {/* Modal header */}
        <div style={{ padding:"18px 18px 0", background:`linear-gradient(160deg,${lc}20,transparent 60%)` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              {m.leagueLogo && <img src={m.leagueLogo} alt="" style={{ width:16,height:16,objectFit:"contain" }} onError={e=>e.target.style.display="none"}/>}
              <span style={{ fontSize:11, color:lc, fontWeight:800 }}>{m.league}</span>
              {m.leagueCountry && <span style={{ fontSize:9, color:"rgba(255,255,255,0.25)" }}>{m.leagueCountry}</span>}
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              {isLive && <span style={{ fontSize:11,color:"#ef4444",fontWeight:800,animation:"pulse 1s infinite" }}>● {m.elapsed}'</span>}
              {isFT && <span style={{ fontSize:10,color:"rgba(255,255,255,0.35)",fontWeight:700 }}>FT</span>}
              <button onClick={()=>onToggleFavMatch(m.id)} style={{ background:"none",border:"none",fontSize:20,cursor:"pointer",padding:0 }}>{isFav?"⭐":"☆"}</button>
              <button onClick={onClose} style={{ background:"rgba(255,255,255,0.07)",border:"none",color:"rgba(255,255,255,0.6)",borderRadius:8,padding:"4px 11px",cursor:"pointer",fontSize:14 }}>✕</button>
            </div>
          </div>

          {/* Teams */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingBottom:16 }}>
            <div style={{ flex:1, textAlign:"center" }}>
              {m.homeLogo && <img src={m.homeLogo} alt="" style={{ width:42,height:42,objectFit:"contain",marginBottom:6 }} onError={e=>e.target.style.display="none"}/>}
              <div style={{ fontWeight:900, fontSize:14, lineHeight:1.2 }}>{m.home}</div>
            </div>
            <div style={{ textAlign:"center", minWidth:80 }}>
              {(isLive||isFT)
                ? <div style={{ fontSize:34,fontWeight:900,letterSpacing:3,color:"#fff" }}>{m.homeScore} – {m.awayScore}</div>
                : <><div style={{ fontSize:12,color:lc,fontWeight:800 }}>VS</div><div style={{ fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:4 }}>{m.time}</div></>
              }
            </div>
            <div style={{ flex:1, textAlign:"center" }}>
              {m.awayLogo && <img src={m.awayLogo} alt="" style={{ width:42,height:42,objectFit:"contain",marginBottom:6 }} onError={e=>e.target.style.display="none"}/>}
              <div style={{ fontWeight:900, fontSize:14, lineHeight:1.2 }}>{m.away}</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:"flex", gap:2, marginBottom:-1 }}>
            {["markets","lineups","stats"].map(t => (
              <button key={t} onClick={()=>setTab(t)} style={{ padding:"9px 18px",background:"none",border:"none",borderBottom:tab===t?`2px solid ${lc}`:"2px solid transparent",color:tab===t?"#fff":"rgba(255,255,255,0.35)",cursor:"pointer",fontWeight:700,fontSize:12,textTransform:"capitalize" }}>{t}</button>
            ))}
          </div>
        </div>

        <div style={{ padding:"16px 16px" }}>

          {/* MARKETS */}
          {tab==="markets" && (
            <>
              <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:8, marginBottom:12 }}>
                {BET_TYPES.map(bt => (
                  <button key={bt.id} onClick={()=>{setBetType(bt.id);setSelOpt(null);}} style={{ padding:"5px 12px",borderRadius:20,whiteSpace:"nowrap",border:betType===bt.id?`1px solid ${lc}`:"1px solid rgba(255,255,255,0.1)",background:betType===bt.id?`${lc}22`:"rgba(255,255,255,0.04)",color:betType===bt.id?lc:"rgba(255,255,255,0.45)",cursor:"pointer",fontSize:11,fontWeight:700 }}>{bt.label}</button>
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:opts.length>3?"1fr 1fr 1fr":`repeat(${opts.length},1fr)`, gap:7, marginBottom:14 }}>
                {opts.map((o,i) => (
                  <button key={i} onClick={()=>setSelOpt(i)} style={{ padding:"10px 4px",borderRadius:10,border:selOpt===i?`2px solid ${lc}`:"2px solid rgba(255,255,255,0.07)",background:selOpt===i?`${lc}18`:"rgba(255,255,255,0.04)",cursor:"pointer",textAlign:"center" }}>
                    <div style={{ fontSize:9,color:"rgba(255,255,255,0.4)",marginBottom:4 }}>{o.label}</div>
                    <div style={{ fontSize:20,fontWeight:900,color:selOpt===i?lc:"#fff" }}>{o.odds}x</div>
                  </button>
                ))}
              </div>
              {selOpt !== null && (
                <div style={{ padding:14, background:"rgba(255,255,255,0.04)", borderRadius:12, border:`1px solid ${lc}33` }}>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", marginBottom:10 }}>
                    Betting on <span style={{ color:lc, fontWeight:700 }}>{opts[selOpt].label}</span> @ <span style={{ color:lc, fontWeight:700 }}>{selOdds}x</span>
                  </div>
                  <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                    {[10,25,50].map(q => (
                      <button key={q} onClick={()=>setAmt(String(Math.min(q,balance)))} style={{ padding:"5px 14px",borderRadius:6,border:`1px solid ${lc}44`,background:`${lc}12`,color:lc,cursor:"pointer",fontSize:12,fontWeight:700 }}>${q}</button>
                    ))}
                    <button onClick={()=>setAmt(String(balance))} style={{ padding:"5px 12px",borderRadius:6,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:12,fontWeight:700 }}>All in</button>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <input value={amt} onChange={e=>setAmt(e.target.value)} type="number" placeholder="Stake..." style={{ flex:1,padding:"10px 14px",borderRadius:8,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",color:"#fff",fontSize:14,outline:"none" }}/>
                    <button onClick={doPlace} disabled={!amt||parseFloat(amt)<1} style={{ padding:"10px 20px",background:lc,color:"#060d1a",border:"none",borderRadius:8,fontWeight:900,cursor:"pointer",fontSize:14,opacity:(!amt||parseFloat(amt)<1)?0.4:1 }}>BET</button>
                  </div>
                  {potential>0 && <div style={{ marginTop:8,fontSize:12,color:"rgba(255,255,255,0.35)" }}>Potential return: <span style={{ color:"#4ade80",fontWeight:700 }}>{fmt(potential)}</span></div>}
                </div>
              )}
            </>
          )}

          {/* LINEUPS */}
          {tab==="lineups" && (tabLoading ? <Loader/> : lineups?.length > 0 ? (
            <>
              <div style={{ background:"linear-gradient(180deg,#1a5c1a,#2e7d2e 45%,#2e7d2e 55%,#1a5c1a)", borderRadius:12, padding:"12px 6px", marginBottom:14 }}>
                <div style={{ fontSize:10,fontWeight:800,color:lc,textAlign:"center",marginBottom:8 }}>{m.home} · {hl?.formation||"?"}</div>
                {renderPitch(hl, false)}
                <div style={{ height:1,background:"rgba(255,255,255,0.15)",margin:"10px 0" }}/>
                {renderPitch(al, true)}
                <div style={{ fontSize:10,fontWeight:800,color:"#60a5fa",textAlign:"center",marginTop:8 }}>{m.away} · {al?.formation||"?"}</div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {[{l:hl,n:m.home,c:lc},{l:al,n:m.away,c:"#60a5fa"}].map((t,ti) => (
                  <div key={ti}>
                    <div style={{ fontSize:11,fontWeight:800,color:t.c,marginBottom:6 }}>{t.n}</div>
                    {(t.l?.startXI||[]).map((p,i) => (
                      <div key={i} style={{ fontSize:10,padding:"3px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",display:"flex",gap:6,color:"rgba(255,255,255,0.7)" }}>
                        <span style={{ color:"rgba(255,255,255,0.2)",minWidth:14 }}>{p.player?.number}</span>{p.player?.name}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : <Empty icon="📋" title="Lineups not confirmed" sub="Released ~60 min before kick-off"/>)}

          {/* STATS */}
          {tab==="stats" && (tabLoading ? <Loader/> : !(isLive||isFT) ? <Empty icon="⏰" title="Match not started yet" sub={m.time}/> : (
            <>
              {(stats?.events||[]).filter(e=>e.type==="Goal").length > 0 && (
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:10,fontWeight:800,color:"rgba(255,255,255,0.3)",letterSpacing:1,marginBottom:8 }}>GOALS</div>
                  {stats.events.filter(e=>e.type==="Goal").map((e,i) => (
                    <div key={i} style={{ display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.05)",fontSize:12 }}>
                      ⚽ <span style={{ fontWeight:700 }}>{e.player?.name}</span>
                      <span style={{ color:"rgba(255,255,255,0.35)",fontSize:11 }}>{e.team?.name}</span>
                      <span style={{ marginLeft:"auto",color:"#e8ff47",fontWeight:700 }}>{e.time?.elapsed}'</span>
                    </div>
                  ))}
                </div>
              )}
              {stats?.stats?.length > 0 ? <>
                <StatBar label="Possession %" a={parseInt(sv(0,"Ball Possession"))||50} b={parseInt(sv(1,"Ball Possession"))||50}/>
                <StatBar label="Total Shots"   a={sv(0,"Total Shots")}   b={sv(1,"Total Shots")}/>
                <StatBar label="On Target"     a={sv(0,"Shots on Target")} b={sv(1,"Shots on Target")}/>
                <StatBar label="Corners"       a={sv(0,"Corner Kicks")} b={sv(1,"Corner Kicks")}/>
                <StatBar label="Fouls"         a={sv(0,"Fouls")}   b={sv(1,"Fouls")}/>
                <StatBar label="Yellow Cards"  a={sv(0,"Yellow Cards")} b={sv(1,"Yellow Cards")}/>
                <StatBar label="Total Passes"  a={sv(0,"Total passes")} b={sv(1,"Total passes")}/>
              </> : <div style={{ textAlign:"center",padding:20,color:"rgba(255,255,255,0.25)",fontSize:12 }}>Stats not available yet</div>}
            </>
          ))}
        </div>
      </div>
    </div>
  );
}

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
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const inp = { width:"100%",padding:"13px 16px",borderRadius:10,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"#fff",fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:12,fontFamily:"'Trebuchet MS',sans-serif" };

  return (
    <div style={{ minHeight:"100vh",background:"linear-gradient(160deg,#050a18,#0c1428)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Trebuchet MS',sans-serif" }}>
      <div style={{ marginBottom:36, textAlign:"center" }}>
        <div style={{ fontSize:52,fontWeight:900,letterSpacing:-3,color:"#fff",lineHeight:1 }}>BET<span style={{ color:"#e8ff47" }}>PLAY</span></div>
        <div style={{ fontSize:13,color:"rgba(255,255,255,0.3)",marginTop:8,letterSpacing:1 }}>⚽ FANTASY BETTING · NO REAL MONEY</div>
      </div>
      <div style={{ width:"100%",maxWidth:360,background:"rgba(255,255,255,0.04)",borderRadius:22,padding:28,border:"1px solid rgba(255,255,255,0.08)",backdropFilter:"blur(10px)" }}>
        <div style={{ display:"flex",gap:4,marginBottom:22,background:"rgba(255,255,255,0.05)",borderRadius:12,padding:4 }}>
          {["login","signup"].map(m => (
            <button key={m} onClick={()=>{setMode(m);setError("");}} style={{ flex:1,padding:"9px",background:mode===m?"#e8ff47":"none",color:mode===m?"#060d1a":"rgba(255,255,255,0.45)",border:"none",borderRadius:9,cursor:"pointer",fontWeight:800,fontSize:13,fontFamily:"'Trebuchet MS',sans-serif" }}>
              {m==="login"?"Log In":"Sign Up"}
            </button>
          ))}
        </div>
        <input style={inp} placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)}/>
        <input style={inp} type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handle()}/>
        {error && <div style={{ color:"#f87171",fontSize:12,marginBottom:10,padding:"8px 12px",background:"rgba(248,113,113,0.08)",borderRadius:8 }}>⚠️ {error}</div>}
        <button onClick={handle} disabled={loading} style={{ width:"100%",padding:"14px",background:"#e8ff47",color:"#060d1a",border:"none",borderRadius:11,fontWeight:900,fontSize:16,cursor:"pointer",fontFamily:"'Trebuchet MS',sans-serif",opacity:loading?0.7:1 }}>
          {loading ? "..." : mode==="login" ? "Log In" : "Create Account"}
        </button>
        {mode==="signup" && <div style={{ marginTop:14,fontSize:11,color:"rgba(255,255,255,0.28)",textAlign:"center" }}>🎁 Start with <strong style={{ color:"#e8ff47" }}>$100.00</strong> free coins</div>}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("matches");
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [toast, setToast] = useState(null);
  const [adCooldown, setAdCooldown] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [activeLeague, setActiveLeague] = useState("live");
  const [search, setSearch] = useState("");
  const [favLeagues, setFavLeagues] = useState(() => new Set(JSON.parse(localStorage.getItem("bp_favLeagues")||"[]")));
  const [favMatches, setFavMatches] = useState(() => new Set(JSON.parse(localStorage.getItem("bp_favMatches")||"[]")));
  const refreshRef = useRef(null);

  // Auto-login
  useEffect(() => {
    const token = localStorage.getItem("bp_token");
    if (!token) return;
    api("/me").then(d => setUser(d)).catch(() => localStorage.removeItem("bp_token"));
  }, []);

  // Ad timer
  useEffect(() => {
    if (adCooldown <= 0) return;
    const t = setTimeout(() => setAdCooldown(c => c-1), 1000);
    return () => clearTimeout(t);
  }, [adCooldown]);

  const showToast = useCallback((msg, color="#e8ff47") => {
    setToast({ msg, color }); setTimeout(() => setToast(null), 3000);
  }, []);

  const toggleFavLeague = useCallback(id => {
    setFavLeagues(prev => {
      const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id);
      localStorage.setItem("bp_favLeagues", JSON.stringify([...n])); return n;
    });
  }, []);

  const toggleFavMatch = useCallback(id => {
    setFavMatches(prev => {
      const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id);
      localStorage.setItem("bp_favMatches", JSON.stringify([...n])); return n;
    });
  }, []);

  const fetchMatches = useCallback(async () => {
    setLoading(true); setFetchError(null);
    try {
      const data = await api("/fixtures");
      setMatches((data.response || []).map(parseFixture));
    } catch(e) { setFetchError(e.message); }
    finally { setLoading(false); }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try { setLeaderboard(await api("/leaderboard")); } catch(_) {}
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchMatches(); fetchLeaderboard();
    refreshRef.current = setInterval(fetchMatches, 60000);
    return () => clearInterval(refreshRef.current);
  }, [user]);

  const handleBet = async (match, optionLabel, amount, odds, market) => {
    try {
      const d = await api("/bet", { method:"POST", body:{ fixtureId:match.fixtureId, matchLabel:`${match.home} vs ${match.away}`, league:match.league, leagueId:match.leagueId, optionLabel, market, amount, odds, potential:Math.round(amount*odds*100)/100, matchTime:match.time } });
      setUser(u => ({ ...u, balance:d.balance, bets:[...(u.bets||[]), d.bet] }));
      showToast(`✅ Bet placed! ${fmt(amount)} @ ${odds}x`);
    } catch(e) { showToast(e.message, "#f87171"); }
  };

  const watchAd = async () => {
    if (adCooldown > 0) return;
    setAdCooldown(30);
    try {
      const d = await api("/adreward", { method:"POST" });
      setUser(u => ({ ...u, balance:d.balance }));
      showToast("📺 +$10 added! 🎉", "#4ade80");
    } catch(e) { showToast(e.message, "#f87171"); }
  };

  const logout = () => { localStorage.removeItem("bp_token"); setUser(null); setMatches([]); };

  if (!user) return <AuthScreen onLogin={u => setUser(u)}/>;

  const bets = user.bets || [];
  const liveMatches = matches.filter(m => m.status === "live");
  const pendingBets = bets.filter(b => b.status === "pending");
  const wonBets = bets.filter(b => b.status === "won");
  const settledBets = bets.filter(b => b.status !== "pending");
  const winRate = settledBets.length > 0 ? Math.round(wonBets.length/settledBets.length*100) : 0;
  const totalWagered = bets.reduce((s,b) => s+b.amount, 0);
  const totalWon = wonBets.reduce((s,b) => s+b.potential, 0);

  // Build league index from matches
  const leagueMap = new Map();
  matches.forEach(m => {
    if (!leagueMap.has(m.leagueId)) leagueMap.set(m.leagueId, { id:m.leagueId, name:m.league, color:m.leagueColor, logo:m.leagueLogo, country:m.leagueCountry, count:0, liveCount:0 });
    const l = leagueMap.get(m.leagueId);
    l.count++;
    if (m.status==="live") l.liveCount++;
  });
  const allLeagues = [...leagueMap.values()].sort((a,b) => {
    if (favLeagues.has(a.id) && !favLeagues.has(b.id)) return -1;
    if (favLeagues.has(b.id) && !favLeagues.has(a.id)) return 1;
    return b.liveCount - a.liveCount || a.name.localeCompare(b.name);
  });

  // Filtered matches for right panel
  const searchLower = search.toLowerCase();
  let rightMatches = [];
  if (activeLeague === "live") rightMatches = liveMatches;
  else if (activeLeague === "favorites") rightMatches = matches.filter(m => favMatches.has(m.id));
  else rightMatches = matches.filter(m => m.leagueId === activeLeague);
  if (search) rightMatches = rightMatches.filter(m =>
    m.home.toLowerCase().includes(searchLower) || m.away.toLowerCase().includes(searchLower)
  );

  const TabBtn = ({ id, label }) => (
    <button onClick={()=>setPage(id)} style={{ flex:1,padding:"9px 0",background:page===id?"#e8ff47":"transparent",color:page===id?"#060d1a":"rgba(255,255,255,0.4)",border:"none",cursor:"pointer",fontWeight:800,fontSize:11,borderRadius:9 }}>{label}</button>
  );

  const MatchCard = ({ m }) => {
    const lc = m.leagueColor;
    const isLive = m.status==="live", isFT = m.status==="finished";
    return (
      <div style={{ background:"rgba(255,255,255,0.04)",borderLeft:`3px solid ${lc}`,border:"1px solid rgba(255,255,255,0.07)",borderRadius:13,padding:"13px 14px",marginBottom:8,animation:"slideUp 0.2s ease",boxShadow:isLive?`0 0 14px ${lc}18`:"none" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:9 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            {m.leagueLogo && <img src={m.leagueLogo} alt="" style={{ width:13,height:13,objectFit:"contain" }} onError={e=>e.target.style.display="none"}/>}
            <span style={{ fontSize:10,color:lc,fontWeight:800 }}>{m.league}</span>
            {m.leagueCountry && <span style={{ fontSize:9,color:"rgba(255,255,255,0.2)" }}>{m.leagueCountry}</span>}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontSize:10,fontWeight:700,color:isLive?"#ef4444":isFT?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.3)" }}>{isLive?`● LIVE ${m.elapsed}'`:isFT?"FT":m.time}</span>
            <button onClick={()=>toggleFavMatch(m.id)} style={{ background:"none",border:"none",fontSize:13,cursor:"pointer",padding:0,color:favMatches.has(m.id)?"#e8ff47":"rgba(255,255,255,0.2)" }}>{favMatches.has(m.id)?"⭐":"☆"}</button>
          </div>
        </div>
        <div onClick={()=>setSelectedMatch(m)} style={{ cursor:"pointer" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:isLive||isFT?0:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
              {m.homeLogo && <img src={m.homeLogo} alt="" style={{ width:20,height:20,objectFit:"contain" }} onError={e=>e.target.style.display="none"}/>}
              <span style={{ fontWeight:800, fontSize:13 }}>{m.home}</span>
            </div>
            {(isLive||isFT)
              ? <div style={{ fontSize:24,fontWeight:900,letterSpacing:2,minWidth:60,textAlign:"center" }}>{m.homeScore} – {m.awayScore}</div>
              : <div style={{ fontSize:10,color:"rgba(255,255,255,0.2)",padding:"3px 8px",background:"rgba(255,255,255,0.04)",borderRadius:5 }}>VS</div>
            }
            <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, justifyContent:"flex-end" }}>
              <span style={{ fontWeight:800, fontSize:13 }}>{m.away}</span>
              {m.awayLogo && <img src={m.awayLogo} alt="" style={{ width:20,height:20,objectFit:"contain" }} onError={e=>e.target.style.display="none"}/>}
            </div>
          </div>
          {!isFT && (
            <div style={{ display:"flex", gap:5, marginTop:10 }}>
              {[{l:m.home,o:m.homeOdds},{l:"Draw",o:m.drawOdds},{l:m.away,o:m.awayOdds}].map((opt,i) => (
                <div key={i} style={{ flex:1,padding:"6px 3px",background:"rgba(255,255,255,0.05)",borderRadius:7,border:"1px solid rgba(255,255,255,0.07)",textAlign:"center" }}>
                  <div style={{ fontSize:8,color:"rgba(255,255,255,0.35)",marginBottom:2,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis" }}>{opt.l}</div>
                  <div style={{ fontSize:14,fontWeight:900 }}>{opt.o}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight:"100vh", background:"#080d1a", fontFamily:"'Trebuchet MS',sans-serif", color:"#fff", maxWidth:480, margin:"0 auto" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes toastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        ::-webkit-scrollbar{width:2px;height:2px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:4px}
        input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
        input[type=number]{-moz-appearance:textfield}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ padding:"14px 14px 0", borderBottom:"1px solid rgba(255,255,255,0.07)", position:"sticky", top:0, background:"rgba(8,13,26,0.97)", backdropFilter:"blur(20px)", zIndex:100 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:22,fontWeight:900,letterSpacing:-1.5 }}>BET<span style={{ color:"#e8ff47" }}>PLAY</span></span>
              {liveMatches.length > 0 && <span style={{ fontSize:10,background:"#ef4444",color:"#fff",borderRadius:6,padding:"2px 7px",fontWeight:800,animation:"pulse 1.5s infinite" }}>● {liveMatches.length} LIVE</span>}
            </div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginTop:1 }}>👋 {user.username}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)" }}>BALANCE</div>
              <div style={{ fontSize:22, fontWeight:900, color:"#e8ff47" }}>{fmt(user.balance)}</div>
            </div>
            <button onClick={logout} style={{ background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",color:"rgba(255,255,255,0.35)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:11 }}>Exit</button>
          </div>
        </div>
        <button onClick={watchAd} disabled={adCooldown>0} style={{ width:"100%",marginTop:9,padding:"8px",background:adCooldown>0?"transparent":"rgba(74,222,128,0.08)",border:adCooldown>0?"1px solid rgba(255,255,255,0.05)":"1px solid rgba(74,222,128,0.2)",borderRadius:9,color:adCooldown>0?"rgba(255,255,255,0.18)":"#4ade80",cursor:adCooldown>0?"not-allowed":"pointer",fontWeight:700,fontSize:12 }}>
          {adCooldown>0 ? `⏳ Next +$10 in ${adCooldown}s` : "📺 Watch Ad · Get $10 FREE"}
        </button>
        <div style={{ display:"flex",gap:3,marginTop:9,background:"rgba(255,255,255,0.04)",borderRadius:11,padding:3 }}>
          <TabBtn id="matches" label="⚽ Matches"/>
          <TabBtn id="mybets"  label={`🎯 Bets${pendingBets.length>0?` (${pendingBets.length})`:""}`}/>
          <TabBtn id="board"   label="🏆 Ranks"/>
          <TabBtn id="profile" label="👤 Profile"/>
        </div>
      </div>

      <div style={{ padding:"12px 12px 80px" }}>

        {/* ── MATCHES PAGE ── */}
        {page==="matches" && (
          <div style={{ display:"flex", gap:8 }}>

            {/* League sidebar */}
            <div style={{ width:68, flexShrink:0, overflowY:"auto", maxHeight:"calc(100vh - 180px)" }}>

              {/* LIVE */}
              <div onClick={()=>setActiveLeague("live")} style={{ marginBottom:5,padding:"7px 3px",borderRadius:10,cursor:"pointer",textAlign:"center",background:activeLeague==="live"?"rgba(239,68,68,0.14)":"rgba(255,255,255,0.04)",border:activeLeague==="live"?"1px solid rgba(239,68,68,0.35)":"1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize:18 }}>🔴</div>
                <div style={{ fontSize:8,fontWeight:800,color:activeLeague==="live"?"#ef4444":"rgba(255,255,255,0.4)",marginTop:2 }}>LIVE</div>
                {liveMatches.length>0 && <div style={{ fontSize:9,color:"#ef4444",fontWeight:900 }}>{liveMatches.length}</div>}
              </div>

              {/* FAVORITES */}
              <div onClick={()=>setActiveLeague("favorites")} style={{ marginBottom:5,padding:"7px 3px",borderRadius:10,cursor:"pointer",textAlign:"center",background:activeLeague==="favorites"?"rgba(232,255,71,0.1)":"rgba(255,255,255,0.04)",border:activeLeague==="favorites"?"1px solid rgba(232,255,71,0.25)":"1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize:18 }}>⭐</div>
                <div style={{ fontSize:8,fontWeight:800,color:activeLeague==="favorites"?"#e8ff47":"rgba(255,255,255,0.4)",marginTop:2 }}>FAV</div>
                {favMatches.size>0 && <div style={{ fontSize:9,color:"#e8ff47" }}>{favMatches.size}</div>}
              </div>

              {/* All leagues */}
              {allLeagues.map(l => {
                const isActive = activeLeague === l.id;
                const isFav = favLeagues.has(l.id);
                const lc = l.color;
                return (
                  <div key={l.id} style={{ marginBottom:5, position:"relative" }}>
                    <div onClick={()=>setActiveLeague(l.id)} style={{ padding:"7px 3px",borderRadius:10,cursor:"pointer",textAlign:"center",background:isActive?`${lc}18`:"rgba(255,255,255,0.04)",border:isActive?`1px solid ${lc}44`:"1px solid rgba(255,255,255,0.06)" }}>
                      {l.logo
                        ? <img src={l.logo} alt="" style={{ width:22,height:22,objectFit:"contain",display:"block",margin:"0 auto" }} onError={e=>{e.target.style.display="none";}}/>
                        : <div style={{ width:22,height:22,background:lc,borderRadius:"50%",margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,color:"#000" }}>{l.name[0]}</div>
                      }
                      <div style={{ fontSize:7.5,color:isActive?lc:"rgba(255,255,255,0.35)",marginTop:3,lineHeight:1.2,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical" }}>{l.name}</div>
                      <div style={{ fontSize:8,color:"rgba(255,255,255,0.2)" }}>{l.count}</div>
                      {l.liveCount>0 && <div style={{ fontSize:7,color:"#ef4444",fontWeight:800 }}>● {l.liveCount}</div>}
                    </div>
                    <button onClick={e=>{e.stopPropagation();toggleFavLeague(l.id);}} style={{ position:"absolute",top:2,right:2,background:"none",border:"none",fontSize:8,cursor:"pointer",padding:0,color:isFav?"#e8ff47":"rgba(255,255,255,0.18)",lineHeight:1 }}>{isFav?"★":"☆"}</button>
                  </div>
                );
              })}
            </div>

            {/* Match list */}
            <div style={{ flex:1, minWidth:0 }}>
              {/* Search */}
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search teams..." style={{ width:"100%",padding:"8px 12px",borderRadius:9,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"#fff",fontSize:12,outline:"none",marginBottom:10,boxSizing:"border-box",fontFamily:"'Trebuchet MS',sans-serif" }}/>

              {fetchError && <div style={{ padding:"10px 12px",background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:10,marginBottom:10,fontSize:11,color:"#f87171",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <span>⚠️ {fetchError}</span>
                <button onClick={fetchMatches} style={{ background:"none",border:"1px solid #f87171",color:"#f87171",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:10 }}>Retry</button>
              </div>}

              {loading && <Loader/>}

              {!loading && activeLeague==="live" && (
                liveMatches.length===0
                  ? <Empty icon="🔴" title="No live matches right now" sub="Check back during match times"/>
                  : liveMatches.filter(m=>!search||(m.home+m.away).toLowerCase().includes(searchLower)).map(m=><MatchCard key={m.id} m={m}/>)
              )}

              {!loading && activeLeague==="favorites" && (
                favMatches.size===0
                  ? <Empty icon="⭐" title="No favourited matches" sub="Tap ☆ on any match to save it here"/>
                  : rightMatches.length===0
                    ? <Empty icon="🔍" title="No results"/>
                    : rightMatches.map(m=><MatchCard key={m.id} m={m}/>)
              )}

              {!loading && activeLeague!=="live" && activeLeague!=="favorites" && (
                rightMatches.length===0
                  ? <Empty icon="📭" title="No matches" sub="No upcoming or recent matches for this league"/>
                  : rightMatches.map(m=><MatchCard key={m.id} m={m}/>)
              )}
            </div>
          </div>
        )}

        {/* ── MY BETS ── */}
        {page==="mybets" && (
          bets.length===0
            ? <Empty icon="🎯" title="No bets yet" sub="Go to Matches and place your first bet"/>
            : [...bets].reverse().map(b => {
              const lc = lcol(b.leagueId);
              const sc = b.status==="won"?"#4ade80":b.status==="lost"?"#f87171":"#fbbf24";
              return (
                <div key={b.id} style={{ background:"rgba(255,255,255,0.04)",borderLeft:`3px solid ${lc}`,border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"13px 15px",marginBottom:9 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10,color:lc,fontWeight:700,marginBottom:3 }}>{b.league}</div>
                      <div style={{ fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:3 }}>{b.match_label}</div>
                      <div style={{ fontWeight:800,fontSize:14 }}>{b.option_label}</div>
                      <div style={{ fontSize:10,color:"rgba(255,255,255,0.25)",marginTop:3 }}>{b.market} · {b.match_time}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)" }}>Staked</div>
                      <div style={{ fontWeight:700,color:"#f87171" }}>{fmt(b.amount)}</div>
                      <div style={{ fontSize:11,color:"#4ade80",marginTop:3 }}>Win: {fmt(b.potential)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop:9,display:"flex",gap:5 }}>
                    <span style={{ fontSize:10,padding:"3px 10px",background:`${lc}18`,color:lc,borderRadius:6,fontWeight:700 }}>{b.odds}x</span>
                    <span style={{ fontSize:10,padding:"3px 10px",background:`${sc}18`,color:sc,borderRadius:6,fontWeight:700 }}>{b.status==="pending"?"⏳ Pending":b.status==="won"?"✅ Won":"❌ Lost"}</span>
                  </div>
                </div>
              );
            })
        )}

        {/* ── LEADERBOARD ── */}
        {page==="board" && (
          <>
            <div style={{ fontSize:10,color:"rgba(255,255,255,0.25)",marginBottom:12,letterSpacing:1 }}>GLOBAL RANKINGS</div>
            {leaderboard.map((p,i) => {
              const isMe = p.username === user.username;
              const medals = ["🏆","🥈","🥉"];
              return (
                <div key={p.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"13px 15px",marginBottom:7,background:isMe?"rgba(232,255,71,0.06)":"rgba(255,255,255,0.04)",border:isMe?"1px solid rgba(232,255,71,0.18)":"1px solid rgba(255,255,255,0.07)",borderRadius:13 }}>
                  <div style={{ fontSize:20,width:32,textAlign:"center" }}>{medals[i]||`#${i+1}`}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800,fontSize:14,color:isMe?"#e8ff47":"#fff" }}>{p.username}{isMe&&<span style={{ fontSize:10,opacity:0.4 }}> (you)</span>}</div>
                    <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:2 }}>{p.wins||0}/{p.total_bets||0} wins</div>
                  </div>
                  <div style={{ fontWeight:900,fontSize:17,color:isMe?"#e8ff47":"#fff" }}>{fmt(p.balance)}</div>
                </div>
              );
            })}
            {leaderboard.length===0 && <Empty icon="🏆" title="No players yet" sub="Be the first to sign up and take the top spot!"/>}
          </>
        )}

        {/* ── PROFILE ── */}
        {page==="profile" && (
          <>
            <div style={{ background:"linear-gradient(135deg,rgba(232,255,71,0.07),rgba(232,255,71,0.02))",border:"1px solid rgba(232,255,71,0.12)",borderRadius:16,padding:18,marginBottom:14 }}>
              <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:16 }}>
                <div style={{ width:50,height:50,borderRadius:"50%",background:"linear-gradient(135deg,#e8ff47,#a3e635)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:900,color:"#060d1a" }}>{user.username[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight:900,fontSize:18 }}>{user.username}</div>
                  <div style={{ fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:2 }}>Joined {new Date(user.joined).toLocaleDateString("en-GB",{month:"short",year:"numeric"})}</div>
                </div>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:9 }}>
                {[
                  {l:"Balance",v:fmt(user.balance),c:"#e8ff47"},
                  {l:"Win Rate",v:`${winRate}%`,c:winRate>=50?"#4ade80":"#f87171"},
                  {l:"Total Bets",v:bets.length,c:"#60a5fa"},
                  {l:"Wagered",v:fmt(totalWagered),c:"#f87171"},
                  {l:"Won",v:wonBets.length,c:"#4ade80"},
                  {l:"Pending",v:pendingBets.length,c:"#fbbf24"},
                ].map((s,i) => (
                  <div key={i} style={{ background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"11px 13px" }}>
                    <div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",marginBottom:3 }}>{s.l}</div>
                    <div style={{ fontSize:19,fontWeight:900,color:s.c }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:15,marginBottom:14 }}>
              <div style={{ fontWeight:800,fontSize:13,marginBottom:10 }}>📊 Profit / Loss</div>
              {[{l:"Total wagered",v:fmt(totalWagered),c:"#fff"},{l:"Total won",v:fmt(totalWon),c:"#4ade80"},{l:"Net P/L",v:fmt(totalWon-totalWagered),c:totalWon>=totalWagered?"#4ade80":"#f87171"}].map((s,i) => (
                <div key={i} style={{ fontSize:13,color:"rgba(255,255,255,0.45)",marginBottom:5 }}>{s.l}: <span style={{ color:s.c,fontWeight:700 }}>{s.v}</span></div>
              ))}
            </div>

            {favLeagues.size>0 && (
              <div style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:15,marginBottom:14 }}>
                <div style={{ fontWeight:800,fontSize:13,marginBottom:10 }}>⭐ Favourite Leagues</div>
                {allLeagues.filter(l=>favLeagues.has(l.id)).map(l => (
                  <div key={l.id} style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8 }}>
                    {l.logo && <img src={l.logo} alt="" style={{ width:16,height:16,objectFit:"contain" }} onError={e=>e.target.style.display="none"}/>}
                    <span style={{ fontSize:13,color:l.color,fontWeight:700 }}>{l.name}</span>
                    <span style={{ fontSize:10,color:"rgba(255,255,255,0.25)" }}>{l.country}</span>
                    <button onClick={()=>toggleFavLeague(l.id)} style={{ marginLeft:"auto",background:"none",border:"1px solid rgba(248,113,113,0.3)",color:"#f87171",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:10 }}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            <button onClick={logout} style={{ width:"100%",padding:13,background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.2)",color:"#f87171",borderRadius:12,fontWeight:800,cursor:"pointer",fontSize:14 }}>← Log Out</button>
          </>
        )}
      </div>

      {selectedMatch && <MatchModal match={selectedMatch} onClose={()=>setSelectedMatch(null)} onBet={handleBet} balance={user.balance} favMatches={favMatches} onToggleFavMatch={toggleFavMatch}/>}
      {toast && <div style={{ position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#0e1628",border:`1px solid ${toast.color}44`,color:toast.color,padding:"11px 20px",borderRadius:12,fontWeight:700,fontSize:13,zIndex:300,whiteSpace:"nowrap",boxShadow:"0 8px 32px rgba(0,0,0,0.7)",animation:"toastIn 0.25s ease" }}>{toast.msg}</div>}
    </div>
  );
}
