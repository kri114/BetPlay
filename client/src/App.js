import { useState, useEffect, useCallback, useRef } from "react";

const BET_TYPES = [
  { id:"1x2",     label:"Match Result" },
  { id:"btts",    label:"Both Teams Score" },
  { id:"ou15",    label:"Over/Under 1.5" },
  { id:"ou25",    label:"Over/Under 2.5" },
  { id:"ou35",    label:"Over/Under 3.5" },
  { id:"dc",      label:"Double Chance" },
  { id:"ht",      label:"Half-Time Result" },
  { id:"cs",      label:"Correct Score" },
  { id:"ag",      label:"Anytime Score" },
  { id:"cards",   label:"Total Cards" },
  { id:"corners", label:"Total Corners" },
];

function getToken() { return localStorage.getItem("bp_token"); }
async function api(path, opts) {
  opts = opts || {};
  const token = getToken();
  const res = await fetch("/api" + path, Object.assign({}, opts, {
    headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const fmt = function(n) { return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const lcol = function(id) {
  var MAP = {"PL":"#3b82f6","CL":"#fbbf24","PD":"#ef4444","BL1":"#f59e0b","SA":"#10b981","FL1":"#8b5cf6","PPL":"#22c55e","ELC":"#60a5fa","BSA":"#84cc16","CLI":"#f97316"};
  return MAP[id] || "#e8ff47";
};

function parseFixture(f) {
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
    homeScore: f.homeScore != null ? f.homeScore : null,
    awayScore: f.awayScore != null ? f.awayScore : null,
    homeOdds: f.homeOdds || 2.50,
    drawOdds: f.drawOdds || 3.20,
    awayOdds: f.awayOdds || 2.80,
  };
}

function getBetOptions(m, t) {
  var h = m.homeOdds, d = m.drawOdds, a = m.awayOdds;
  var homeFav = h < a;
  var bigFav = Math.abs(h - a) > 1.2;
  switch(t) {
    case "1x2": return [{ label: m.home, odds: h }, { label: "Draw", odds: d }, { label: m.away, odds: a }];
    case "btts": return [{ label: "Both Score - Yes", odds: bigFav ? 1.65 : 1.80 }, { label: "Both Score - No", odds: bigFav ? 2.10 : 1.95 }];
    case "ou15": return [{ label: "Over 1.5 Goals", odds: 1.35 }, { label: "Under 1.5 Goals", odds: 3.00 }];
    case "ou25": return [{ label: "Over 2.5 Goals", odds: 1.88 }, { label: "Under 2.5 Goals", odds: 1.88 }];
    case "ou35": return [{ label: "Over 3.5 Goals", odds: 2.75 }, { label: "Under 3.5 Goals", odds: 1.45 }];
    case "dc": return [
      { label: m.home + " or Draw", odds: Math.max(1.05, +(h * 0.55).toFixed(2)) },
      { label: m.away + " or Draw", odds: Math.max(1.05, +(a * 0.55).toFixed(2)) },
      { label: m.home + " or " + m.away, odds: Math.max(1.05, +(d * 0.45).toFixed(2)) },
    ];
    case "ht": return [
      { label: m.home + " leads HT", odds: +(h * 1.35).toFixed(2) },
      { label: "HT Draw", odds: 2.05 },
      { label: m.away + " leads HT", odds: +(a * 1.35).toFixed(2) },
    ];
    case "cs": return [
      { label: "1-0", odds: homeFav ? 5.50 : 7.00 },
      { label: "2-0", odds: homeFav ? 7.00 : 9.50 },
      { label: "2-1", odds: homeFav ? 6.50 : 8.50 },
      { label: "1-1", odds: 5.00 },
      { label: "0-0", odds: 6.50 },
      { label: "0-1", odds: homeFav ? 7.00 : 5.50 },
      { label: "0-2", odds: homeFav ? 9.50 : 7.00 },
      { label: "1-2", odds: homeFav ? 8.50 : 6.50 },
      { label: "2-2", odds: 9.00 },
      { label: "3-1", odds: 12.00 },
      { label: "3-0", odds: 13.00 },
      { label: "Other", odds: 4.50 },
    ];
    case "ag": return [
      { label: m.home + " to score", odds: Math.max(1.05, +(h * 0.70).toFixed(2)) },
      { label: m.away + " to score", odds: Math.max(1.05, +(a * 0.70).toFixed(2)) },
      { label: "Both teams score", odds: 1.80 },
      { label: "Over 1 goal", odds: 1.30 },
    ];
    case "cards": return [
      { label: "Over 3.5 cards", odds: 1.90 },
      { label: "Under 3.5 cards", odds: 1.85 },
      { label: "Over 4.5 cards", odds: 2.80 },
      { label: "Under 4.5 cards", odds: 1.40 },
    ];
    case "corners": return [
      { label: "Over 9.5 corners", odds: 1.85 },
      { label: "Under 9.5 corners", odds: 1.90 },
      { label: "Over 11.5 corners", odds: 2.60 },
      { label: "Under 11.5 corners", odds: 1.45 },
    ];
    default: return [];
  }
}

function StatBar({ label, a, b }) {
  var na = parseInt(a) || 0, nb = parseInt(b) || 0, tot = na + nb;
  var pct = tot > 0 ? (na / tot) * 100 : 50;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
        <b style={{ color: "#fff" }}>{na}</b>
        <span style={{ color: "rgba(255,255,255,0.35)" }}>{label}</span>
        <b style={{ color: "#fff" }}>{nb}</b>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct + "%", background: "linear-gradient(90deg,#e8ff47,#a3e635)", borderRadius: 2 }} />
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.3)" }}>
      <div style={{ width: 28, height: 28, border: "3px solid rgba(255,255,255,0.1)", borderTop: "3px solid #e8ff47", borderRadius: "50%", margin: "0 auto 8px", animation: "spin 0.8s linear infinite" }} />
      Loading...
    </div>
  );
}

function Empty({ icon, title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 16px" }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.55)", marginBottom: 6 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.28)", lineHeight: 1.6 }}>{sub}</div>}
    </div>
  );
}

function MatchModal({ match: m, onClose, onBet, balance, favMatches, onToggleFavMatch }) {
  var [tab, setTab] = useState("markets");
  var [betType, setBetType] = useState("1x2");
  var [selOpt, setSelOpt] = useState(null);
  var [amt, setAmt] = useState("");
  var [lineups, setLineups] = useState(null);
  var [stats, setStats] = useState(null);
  var [tabLoading, setTabLoading] = useState(false);
  var lc = m.leagueColor || "#e8ff47";
  var opts = getBetOptions(m, betType);
  var selOdds = selOpt !== null ? opts[selOpt] && opts[selOpt].odds : null;
  var potential = amt && selOdds ? Math.round(parseFloat(amt) * selOdds * 100) / 100 : 0;
  var isLive = m.status === "live";
  var isFT = m.status === "finished";
  var isFav = favMatches.has(m.id);

  useEffect(function() {
    if (tab !== "lineups" || lineups) return;
    setTabLoading(true);
    api("/fixtures/" + m.fixtureId + "/lineups")
      .then(function(d) { setLineups(d.response || []); })
      .catch(function() { setLineups([]); })
      .finally(function() { setTabLoading(false); });
  }, [tab]);

  useEffect(function() {
    if (tab !== "stats" || stats) return;
    setTabLoading(true);
    api("/fixtures/" + m.fixtureId + "/stats")
      .then(function(d) { setStats(d); })
      .catch(function() { setStats({ stats: [], events: [] }); })
      .finally(function() { setTabLoading(false); });
  }, [tab]);

  var sv = function(ti, key) {
    if (!stats || !stats.stats || !stats.stats[ti]) return 0;
    var found = stats.stats[ti].statistics && stats.stats[ti].statistics.find(function(s) { return s.type === key; });
    return found ? found.value : 0;
  };

  var doPlace = function() {
    var a = parseFloat(amt);
    if (!a || a < 1 || selOpt === null) return;
    var btLabel = BET_TYPES.find(function(b) { return b.id === betType; });
    onBet(m, opts[selOpt].label, a, selOdds, btLabel ? btLabel.label : betType);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 480, background: "#0b1120", borderRadius: "22px 22px 0 0", maxHeight: "94vh", overflowY: "auto", paddingBottom: 36 }} onClick={function(e) { e.stopPropagation(); }}>

        <div style={{ padding: "18px 18px 0", background: "linear-gradient(160deg," + lc + "20,transparent 60%)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {m.leagueLogo && <img src={m.leagueLogo} alt="" style={{ width: 16, height: 16, objectFit: "contain" }} onError={function(e) { e.target.style.display = "none"; }} />}
              <span style={{ fontSize: 11, color: lc, fontWeight: 800 }}>{m.league}</span>
              {m.leagueCountry && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{m.leagueCountry}</span>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {isLive && <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 800 }}>LIVE {m.elapsed ? m.elapsed + "'" : ""}</span>}
              {isFT && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 700 }}>FT</span>}
              <button onClick={function() { onToggleFavMatch(m.id); }} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", padding: 0 }}>{isFav ? "*" : "o"}</button>
              <button onClick={onClose} style={{ background: "rgba(255,255,255,0.07)", border: "none", color: "rgba(255,255,255,0.6)", borderRadius: 8, padding: "4px 11px", cursor: "pointer", fontSize: 14 }}>X</button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16 }}>
            <div style={{ flex: 1, textAlign: "center" }}>
              {m.homeLogo && <img src={m.homeLogo} alt="" style={{ width: 42, height: 42, objectFit: "contain", marginBottom: 6 }} onError={function(e) { e.target.style.display = "none"; }} />}
              <div style={{ fontWeight: 900, fontSize: 14, lineHeight: 1.2 }}>{m.home}</div>
            </div>
            <div style={{ textAlign: "center", minWidth: 80 }}>
              {(isLive || isFT)
                ? <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 3, color: "#fff" }}>{m.homeScore} - {m.awayScore}</div>
                : <div><div style={{ fontSize: 12, color: lc, fontWeight: 800 }}>VS</div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>{m.time}</div></div>
              }
            </div>
            <div style={{ flex: 1, textAlign: "center" }}>
              {m.awayLogo && <img src={m.awayLogo} alt="" style={{ width: 42, height: 42, objectFit: "contain", marginBottom: 6 }} onError={function(e) { e.target.style.display = "none"; }} />}
              <div style={{ fontWeight: 900, fontSize: 14, lineHeight: 1.2 }}>{m.away}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 2, marginBottom: -1 }}>
            {["markets", "lineups", "stats"].map(function(t) {
              return <button key={t} onClick={function() { setTab(t); }} style={{ padding: "9px 18px", background: "none", border: "none", borderBottom: tab === t ? "2px solid " + lc : "2px solid transparent", color: tab === t ? "#fff" : "rgba(255,255,255,0.35)", cursor: "pointer", fontWeight: 700, fontSize: 12, textTransform: "capitalize" }}>{t}</button>;
            })}
          </div>
        </div>

        <div style={{ padding: "16px 16px" }}>

          {tab === "markets" && (
            <div>
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 12 }}>
                {BET_TYPES.map(function(bt) {
                  return <button key={bt.id} onClick={function() { setBetType(bt.id); setSelOpt(null); }} style={{ padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap", border: betType === bt.id ? "1px solid " + lc : "1px solid rgba(255,255,255,0.1)", background: betType === bt.id ? lc + "22" : "rgba(255,255,255,0.04)", color: betType === bt.id ? lc : "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>{bt.label}</button>;
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: betType === "cs" ? "1fr 1fr 1fr 1fr" : opts.length > 3 ? "1fr 1fr 1fr" : "repeat(" + opts.length + ",1fr)", gap: 7, marginBottom: 14 }}>
                {opts.map(function(o, i) {
                  return (
                    <button key={i} onClick={function() { setSelOpt(i); }} style={{ padding: "10px 4px", borderRadius: 10, border: selOpt === i ? "2px solid " + lc : "2px solid rgba(255,255,255,0.07)", background: selOpt === i ? lc + "18" : "rgba(255,255,255,0.04)", cursor: "pointer", textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>{o.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: selOpt === i ? lc : "#fff" }}>{o.odds}x</div>
                    </button>
                  );
                })}
              </div>
              {selOpt !== null && (
                <div style={{ padding: 14, background: "rgba(255,255,255,0.04)", borderRadius: 12, border: "1px solid " + lc + "33" }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 10 }}>
                    Betting on <span style={{ color: lc, fontWeight: 700 }}>{opts[selOpt].label}</span> at <span style={{ color: lc, fontWeight: 700 }}>{selOdds}x</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {[10, 25, 50].map(function(q) {
                      return <button key={q} onClick={function() { setAmt(String(Math.min(q, balance))); }} style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid " + lc + "44", background: lc + "12", color: lc, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>${q}</button>;
                    })}
                    <button onClick={function() { setAmt(String(balance)); }} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>All in</button>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={amt} onChange={function(e) { setAmt(e.target.value); }} type="number" placeholder="Stake..." style={{ flex: 1, padding: "10px 14px", borderRadius: 8, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 14, outline: "none" }} />
                    <button onClick={doPlace} disabled={!amt || parseFloat(amt) < 1} style={{ padding: "10px 20px", background: lc, color: "#060d1a", border: "none", borderRadius: 8, fontWeight: 900, cursor: "pointer", fontSize: 14, opacity: (!amt || parseFloat(amt) < 1) ? 0.4 : 1 }}>BET</button>
                  </div>
                  {potential > 0 && <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Potential return: <span style={{ color: "#4ade80", fontWeight: 700 }}>{fmt(potential)}</span></div>}
                </div>
              )}
            </div>
          )}

          {tab === "lineups" && (
            <div style={{ textAlign: "center", padding: "36px 20px" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>clipboard</div>
              <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>Lineups not available</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.28)", lineHeight: 1.7 }}>
                Our current data plan does not include lineups.
              </div>
            </div>
          )}

          {tab === "stats" && (
            tabLoading ? <Loader /> :
            !(isLive || isFT) ? <Empty icon="clock" title="No stats yet" sub={"Match kicks off " + m.time} /> :
            (
              <div>
                {stats && stats.events && stats.events.filter(function(e) { return e.type === "Goal"; }).length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.3)", letterSpacing: 1, marginBottom: 8 }}>GOALS</div>
                    {stats.events.filter(function(e) { return e.type === "Goal"; }).map(function(e, i) {
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 12 }}>
                          <span style={{ fontWeight: 700 }}>{e.player && e.player.name}</span>
                          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>{e.team && e.team.name}</span>
                          <span style={{ marginLeft: "auto", color: "#e8ff47", fontWeight: 700 }}>{e.time && e.time.elapsed}'</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {stats && stats.stats && stats.stats.length > 0 ? (
                  <div>
                    <StatBar label="Possession %" a={parseInt(sv(0, "Ball Possession")) || 50} b={parseInt(sv(1, "Ball Possession")) || 50} />
                    <StatBar label="Total Shots" a={sv(0, "Total Shots")} b={sv(1, "Total Shots")} />
                    <StatBar label="On Target" a={sv(0, "Shots on Target")} b={sv(1, "Shots on Target")} />
                    <StatBar label="Corners" a={sv(0, "Corner Kicks")} b={sv(1, "Corner Kicks")} />
                    <StatBar label="Fouls" a={sv(0, "Fouls")} b={sv(1, "Fouls")} />
                    <StatBar label="Yellow Cards" a={sv(0, "Yellow Cards")} b={sv(1, "Yellow Cards")} />
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: 20, color: "rgba(255,255,255,0.25)", fontSize: 12 }}>Stats not available yet</div>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function AuthScreen({ onLogin }) {
  var [mode, setMode] = useState("login");
  var [username, setUsername] = useState("");
  var [password, setPassword] = useState("");
  var [error, setError] = useState("");
  var [loading, setLoading] = useState(false);

  var handle = function() {
    if (!username.trim() || !password.trim()) { setError("Fill in all fields"); return; }
    setLoading(true); setError("");
    api("/auth/" + mode, { method: "POST", body: { username: username, password: password } })
      .then(function(data) {
        localStorage.setItem("bp_token", data.token);
        onLogin(data.user);
      })
      .catch(function(e) { setError(e.message); })
      .finally(function() { setLoading(false); });
  };

  var inp = { width: "100%", padding: "13px 16px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 12, fontFamily: "'Trebuchet MS',sans-serif" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#050a18,#0c1428)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Trebuchet MS',sans-serif" }}>
      <div style={{ marginBottom: 36, textAlign: "center" }}>
        <div style={{ fontSize: 52, fontWeight: 900, letterSpacing: -3, color: "#fff", lineHeight: 1 }}>BET<span style={{ color: "#e8ff47" }}>PLAY</span></div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginTop: 8, letterSpacing: 1 }}>FANTASY BETTING - NO REAL MONEY</div>
      </div>
      <div style={{ width: "100%", maxWidth: 360, background: "rgba(255,255,255,0.04)", borderRadius: 22, padding: 28, border: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 22, background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 4 }}>
          {["login", "signup"].map(function(m) {
            return <button key={m} onClick={function() { setMode(m); setError(""); }} style={{ flex: 1, padding: "9px", background: mode === m ? "#e8ff47" : "none", color: mode === m ? "#060d1a" : "rgba(255,255,255,0.45)", border: "none", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 13, fontFamily: "'Trebuchet MS',sans-serif" }}>{m === "login" ? "Log In" : "Sign Up"}</button>;
          })}
        </div>
        <input style={inp} placeholder="Username" value={username} onChange={function(e) { setUsername(e.target.value); }} />
        <input style={inp} type="password" placeholder="Password" value={password} onChange={function(e) { setPassword(e.target.value); }} onKeyDown={function(e) { if (e.key === "Enter") handle(); }} />
        {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10, padding: "8px 12px", background: "rgba(248,113,113,0.08)", borderRadius: 8 }}>{error}</div>}
        <button onClick={handle} disabled={loading} style={{ width: "100%", padding: "14px", background: "#e8ff47", color: "#060d1a", border: "none", borderRadius: 11, fontWeight: 900, fontSize: 16, cursor: "pointer", fontFamily: "'Trebuchet MS',sans-serif", opacity: loading ? 0.7 : 1 }}>
          {loading ? "..." : mode === "login" ? "Log In" : "Create Account"}
        </button>
        {mode === "signup" && <div style={{ marginTop: 14, fontSize: 11, color: "rgba(255,255,255,0.28)", textAlign: "center" }}>Start with <strong style={{ color: "#e8ff47" }}>$100.00</strong> free coins</div>}
      </div>
    </div>
  );
}

export default function App() {
  var [user, setUser] = useState(null);
  var [page, setPage] = useState("matches");
  var [matches, setMatches] = useState([]);
  var [loading, setLoading] = useState(false);
  var [fetchError, setFetchError] = useState(null);
  var [selectedMatch, setSelectedMatch] = useState(null);
  var [toast, setToast] = useState(null);
  var [adCooldown, setAdCooldown] = useState(0);
  var [leaderboard, setLeaderboard] = useState([]);
  var [activeLeague, setActiveLeague] = useState("live");
  var [search, setSearch] = useState("");
  var [favLeagues, setFavLeagues] = useState(function() { return new Set(JSON.parse(localStorage.getItem("bp_favLeagues") || "[]")); });
  var [favMatches, setFavMatches] = useState(function() { return new Set(JSON.parse(localStorage.getItem("bp_favMatches") || "[]")); });
  var refreshRef = useRef(null);

  useEffect(function() {
    var token = localStorage.getItem("bp_token");
    if (!token) return;
    api("/me").then(function(d) { setUser(d); }).catch(function() { localStorage.removeItem("bp_token"); });
  }, []);

  useEffect(function() {
    if (adCooldown <= 0) return;
    var t = setTimeout(function() { setAdCooldown(function(c) { return c - 1; }); }, 1000);
    return function() { clearTimeout(t); };
  }, [adCooldown]);

  var showToast = useCallback(function(msg, color) {
    color = color || "#e8ff47";
    setToast({ msg: msg, color: color });
    setTimeout(function() { setToast(null); }, 3000);
  }, []);

  var toggleFavLeague = useCallback(function(id) {
    setFavLeagues(function(prev) {
      var n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      localStorage.setItem("bp_favLeagues", JSON.stringify(Array.from(n)));
      return n;
    });
  }, []);

  var toggleFavMatch = useCallback(function(id) {
    setFavMatches(function(prev) {
      var n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      localStorage.setItem("bp_favMatches", JSON.stringify(Array.from(n)));
      return n;
    });
  }, []);

  var fetchMatches = useCallback(function() {
    setLoading(true); setFetchError(null);
    api("/fixtures")
      .then(function(data) { setMatches((data.response || []).map(parseFixture)); })
      .catch(function(e) { setFetchError(e.message); })
      .finally(function() { setLoading(false); });
  }, []);

  var fetchLeaderboard = useCallback(function() {
    api("/leaderboard").then(function(d) { setLeaderboard(d); }).catch(function() {});
  }, []);

  useEffect(function() {
    if (!user) return;
    fetchMatches(); fetchLeaderboard();
    refreshRef.current = setInterval(fetchMatches, 60000);
    return function() { clearInterval(refreshRef.current); };
  }, [user]);

  var handleBet = function(match, optionLabel, amount, odds, market) {
    api("/bet", { method: "POST", body: { fixtureId: match.fixtureId, matchLabel: match.home + " vs " + match.away, league: match.league, leagueId: match.leagueId, optionLabel: optionLabel, market: market, amount: amount, odds: odds, potential: Math.round(amount * odds * 100) / 100, matchTime: match.time } })
      .then(function(d) {
        setUser(function(u) { return Object.assign({}, u, { balance: d.balance, bets: (u.bets || []).concat([d.bet]) }); });
        showToast("Bet placed! " + fmt(amount) + " @ " + odds + "x");
      })
      .catch(function(e) { showToast(e.message, "#f87171"); });
  };

  var watchAd = function() {
    if (adCooldown > 0) return;
    setAdCooldown(30);
    api("/adreward", { method: "POST" })
      .then(function(d) { setUser(function(u) { return Object.assign({}, u, { balance: d.balance }); }); showToast("+$10 added!", "#4ade80"); })
      .catch(function(e) { showToast(e.message, "#f87171"); });
  };

  var logout = function() { localStorage.removeItem("bp_token"); setUser(null); setMatches([]); };

  if (!user) return <AuthScreen onLogin={function(u) { setUser(u); }} />;

  var bets = user.bets || [];
  var liveMatches = matches.filter(function(m) { return m.status === "live"; });
  var pendingBets = bets.filter(function(b) { return b.status === "pending"; });
  var wonBets = bets.filter(function(b) { return b.status === "won"; });
  var settledBets = bets.filter(function(b) { return b.status !== "pending"; });
  var winRate = settledBets.length > 0 ? Math.round(wonBets.length / settledBets.length * 100) : 0;
  var totalWagered = bets.reduce(function(s, b) { return s + b.amount; }, 0);
  var totalWon = wonBets.reduce(function(s, b) { return s + b.potential; }, 0);

  var leagueMap = new Map();
  matches.forEach(function(m) {
    if (!leagueMap.has(m.leagueId)) leagueMap.set(m.leagueId, { id: m.leagueId, name: m.league, color: m.leagueColor, logo: m.leagueLogo, country: m.leagueCountry, count: 0, liveCount: 0 });
    var l = leagueMap.get(m.leagueId);
    l.count++;
    if (m.status === "live") l.liveCount++;
  });
  var allLeagues = Array.from(leagueMap.values()).sort(function(a, b) {
    if (favLeagues.has(a.id) && !favLeagues.has(b.id)) return -1;
    if (favLeagues.has(b.id) && !favLeagues.has(a.id)) return 1;
    return b.liveCount - a.liveCount || a.name.localeCompare(b.name);
  });

  var searchLower = search.toLowerCase();
  var rightMatches = [];
  if (activeLeague === "live") rightMatches = liveMatches;
  else if (activeLeague === "favorites") rightMatches = matches.filter(function(m) { return favMatches.has(m.id); });
  else rightMatches = matches.filter(function(m) { return m.leagueId === activeLeague; });
  if (search) rightMatches = rightMatches.filter(function(m) { return m.home.toLowerCase().includes(searchLower) || m.away.toLowerCase().includes(searchLower); });

  var TabBtn = function(props) {
    return <button onClick={function() { setPage(props.id); }} style={{ flex: 1, padding: "9px 0", background: page === props.id ? "#e8ff47" : "transparent", color: page === props.id ? "#060d1a" : "rgba(255,255,255,0.4)", border: "none", cursor: "pointer", fontWeight: 800, fontSize: 11, borderRadius: 9 }}>{props.label}</button>;
  };

  var MatchCard = function(props) {
    var m = props.m;
    var lc = m.leagueColor;
    var isLive = m.status === "live";
    var isFT = m.status === "finished";
    return (
      <div style={{ background: "rgba(255,255,255,0.04)", borderLeft: "3px solid " + lc, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 13, padding: "13px 14px", marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {m.leagueLogo && <img src={m.leagueLogo} alt="" style={{ width: 13, height: 13, objectFit: "contain" }} onError={function(e) { e.target.style.display = "none"; }} />}
            <span style={{ fontSize: 10, color: lc, fontWeight: 800 }}>{m.league}</span>
            {m.leagueCountry && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{m.leagueCountry}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: isLive ? "#ef4444" : isFT ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.3)" }}>{isLive ? ("LIVE " + (m.elapsed ? m.elapsed + "'" : "")) : isFT ? "FT" : m.time}</span>
            <button onClick={function() { toggleFavMatch(m.id); }} style={{ background: "none", border: "none", fontSize: 13, cursor: "pointer", padding: 0, color: favMatches.has(m.id) ? "#e8ff47" : "rgba(255,255,255,0.2)" }}>{favMatches.has(m.id) ? "star" : "star-o"}</button>
          </div>
        </div>
        <div onClick={function() { setSelectedMatch(m); }} style={{ cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: (isLive || isFT) ? 0 : 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
              {m.homeLogo && <img src={m.homeLogo} alt="" style={{ width: 20, height: 20, objectFit: "contain" }} onError={function(e) { e.target.style.display = "none"; }} />}
              <span style={{ fontWeight: 800, fontSize: 13 }}>{m.home}</span>
            </div>
            {(isLive || isFT)
              ? <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 2, minWidth: 60, textAlign: "center" }}>{m.homeScore} - {m.awayScore}</div>
              : <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", padding: "3px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 5 }}>VS</div>
            }
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>{m.away}</span>
              {m.awayLogo && <img src={m.awayLogo} alt="" style={{ width: 20, height: 20, objectFit: "contain" }} onError={function(e) { e.target.style.display = "none"; }} />}
            </div>
          </div>
          {!isFT && (
            <div style={{ display: "flex", gap: 5, marginTop: 10 }}>
              {[{ l: m.home, o: m.homeOdds }, { l: "Draw", o: m.drawOdds }, { l: m.away, o: m.awayOdds }].map(function(opt, i) {
                return (
                  <div key={i} style={{ flex: 1, padding: "6px 3px", background: "rgba(255,255,255,0.05)", borderRadius: 7, border: "1px solid rgba(255,255,255,0.07)", textAlign: "center" }}>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", marginBottom: 2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{opt.l}</div>
                    <div style={{ fontSize: 14, fontWeight: 900 }}>{opt.o}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#080d1a", fontFamily: "'Trebuchet MS',sans-serif", color: "#fff", maxWidth: 480, margin: "0 auto" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes toastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} ::-webkit-scrollbar{width:2px;height:2px} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:4px} input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none} input[type=number]{-moz-appearance:textfield}`}</style>

      <div style={{ padding: "14px 14px 0", borderBottom: "1px solid rgba(255,255,255,0.07)", position: "sticky", top: 0, background: "rgba(8,13,26,0.97)", backdropFilter: "blur(20px)", zIndex: 100 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: -1.5 }}>BET<span style={{ color: "#e8ff47" }}>PLAY</span></span>
              {liveMatches.length > 0 && <span style={{ fontSize: 10, background: "#ef4444", color: "#fff", borderRadius: 6, padding: "2px 7px", fontWeight: 800 }}>{liveMatches.length} LIVE</span>}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>Hi, {user.username}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>BALANCE</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#e8ff47" }}>{fmt(user.balance)}</div>
            </div>
            <button onClick={logout} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.35)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>Exit</button>
          </div>
        </div>
        <button onClick={watchAd} disabled={adCooldown > 0} style={{ width: "100%", marginTop: 9, padding: "8px", background: adCooldown > 0 ? "transparent" : "rgba(74,222,128,0.08)", border: adCooldown > 0 ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(74,222,128,0.2)", borderRadius: 9, color: adCooldown > 0 ? "rgba(255,255,255,0.18)" : "#4ade80", cursor: adCooldown > 0 ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 12 }}>
          {adCooldown > 0 ? ("Next +$10 in " + adCooldown + "s") : "Watch Ad - Get $10 FREE"}
        </button>
        <div style={{ display: "flex", gap: 3, marginTop: 9, background: "rgba(255,255,255,0.04)", borderRadius: 11, padding: 3 }}>
          <TabBtn id="matches" label="Matches" />
          <TabBtn id="mybets" label={"Bets" + (pendingBets.length > 0 ? " (" + pendingBets.length + ")" : "")} />
          <TabBtn id="board" label="Ranks" />
          <TabBtn id="profile" label="Profile" />
        </div>
      </div>

      <div style={{ padding: "12px 12px 80px" }}>

        {page === "matches" && (
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 68, flexShrink: 0, overflowY: "auto", maxHeight: "calc(100vh - 180px)" }}>
              <div onClick={function() { setActiveLeague("live"); }} style={{ marginBottom: 5, padding: "7px 3px", borderRadius: 10, cursor: "pointer", textAlign: "center", background: activeLeague === "live" ? "rgba(239,68,68,0.14)" : "rgba(255,255,255,0.04)", border: activeLeague === "live" ? "1px solid rgba(239,68,68,0.35)" : "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 18 }}>&#x1F534;</div>
                <div style={{ fontSize: 8, fontWeight: 800, color: activeLeague === "live" ? "#ef4444" : "rgba(255,255,255,0.4)", marginTop: 2 }}>LIVE</div>
                {liveMatches.length > 0 && <div style={{ fontSize: 9, color: "#ef4444", fontWeight: 900 }}>{liveMatches.length}</div>}
              </div>
              <div onClick={function() { setActiveLeague("favorites"); }} style={{ marginBottom: 5, padding: "7px 3px", borderRadius: 10, cursor: "pointer", textAlign: "center", background: activeLeague === "favorites" ? "rgba(232,255,71,0.1)" : "rgba(255,255,255,0.04)", border: activeLeague === "favorites" ? "1px solid rgba(232,255,71,0.25)" : "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 18 }}>&#x2B50;</div>
                <div style={{ fontSize: 8, fontWeight: 800, color: activeLeague === "favorites" ? "#e8ff47" : "rgba(255,255,255,0.4)", marginTop: 2 }}>FAV</div>
                {favMatches.size > 0 && <div style={{ fontSize: 9, color: "#e8ff47" }}>{favMatches.size}</div>}
              </div>
              {allLeagues.map(function(l) {
                var isActive = activeLeague === l.id;
                var isFav = favLeagues.has(l.id);
                var lc = l.color;
                return (
                  <div key={l.id} style={{ marginBottom: 5, position: "relative" }}>
                    <div onClick={function() { setActiveLeague(l.id); }} style={{ padding: "7px 3px", borderRadius: 10, cursor: "pointer", textAlign: "center", background: isActive ? lc + "18" : "rgba(255,255,255,0.04)", border: isActive ? "1px solid " + lc + "44" : "1px solid rgba(255,255,255,0.06)" }}>
                      {l.logo
                        ? <img src={l.logo} alt="" style={{ width: 22, height: 22, objectFit: "contain", display: "block", margin: "0 auto" }} onError={function(e) { e.target.style.display = "none"; }} />
                        : <div style={{ width: 22, height: 22, background: lc, borderRadius: "50%", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 900, color: "#000" }}>{l.name[0]}</div>
                      }
                      <div style={{ fontSize: 7.5, color: isActive ? lc : "rgba(255,255,255,0.35)", marginTop: 3, lineHeight: 1.2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{l.name}</div>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{l.count}</div>
                      {l.liveCount > 0 && <div style={{ fontSize: 7, color: "#ef4444", fontWeight: 800 }}>{l.liveCount} live</div>}
                    </div>
                    <button onClick={function(e) { e.stopPropagation(); toggleFavLeague(l.id); }} style={{ position: "absolute", top: 2, right: 2, background: "none", border: "none", fontSize: 8, cursor: "pointer", padding: 0, color: isFav ? "#e8ff47" : "rgba(255,255,255,0.18)", lineHeight: 1 }}>{isFav ? "star" : "star-o"}</button>
                  </div>
                );
              })}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Search teams..." style={{ width: "100%", padding: "8px 12px", borderRadius: 9, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, outline: "none", marginBottom: 10, boxSizing: "border-box", fontFamily: "'Trebuchet MS',sans-serif" }} />
              {fetchError && <div style={{ padding: "10px 12px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, marginBottom: 10, fontSize: 11, color: "#f87171", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{fetchError}</span>
                <button onClick={fetchMatches} style={{ background: "none", border: "1px solid #f87171", color: "#f87171", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: 10 }}>Retry</button>
              </div>}
              {loading && <Loader />}
              {!loading && rightMatches.length === 0 && !fetchError && (
                activeLeague === "live" ? <Empty icon="(live)" title="No live matches right now" sub="Check back during match times" /> :
                activeLeague === "favorites" ? <Empty icon="(star)" title="No favourited matches" sub="Tap the star on any match to save it here" /> :
                <Empty icon="(empty)" title="No matches" sub="No upcoming or recent matches for this league" />
              )}
              {!loading && rightMatches.map(function(m) { return <MatchCard key={m.id} m={m} />; })}
            </div>
          </div>
        )}

        {page === "mybets" && (
          bets.length === 0
            ? <Empty icon="(bets)" title="No bets yet" sub="Go to Matches and place your first bet" />
            : [...bets].reverse().map(function(b) {
              var lc = lcol(b.leagueId);
              var sc = b.status === "won" ? "#4ade80" : b.status === "lost" ? "#f87171" : "#fbbf24";
              return (
                <div key={b.id} style={{ background: "rgba(255,255,255,0.04)", borderLeft: "3px solid " + lc, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "13px 15px", marginBottom: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: lc, fontWeight: 700, marginBottom: 3 }}>{b.league}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 3 }}>{b.match_label}</div>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{b.option_label}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 3 }}>{b.market} - {b.match_time}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Staked</div>
                      <div style={{ fontWeight: 700, color: "#f87171" }}>{fmt(b.amount)}</div>
                      <div style={{ fontSize: 11, color: "#4ade80", marginTop: 3 }}>Win: {fmt(b.potential)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 9, display: "flex", gap: 5 }}>
                    <span style={{ fontSize: 10, padding: "3px 10px", background: lc + "18", color: lc, borderRadius: 6, fontWeight: 700 }}>{b.odds}x</span>
                    <span style={{ fontSize: 10, padding: "3px 10px", background: sc + "18", color: sc, borderRadius: 6, fontWeight: 700 }}>{b.status === "pending" ? "Pending" : b.status === "won" ? "Won" : "Lost"}</span>
                  </div>
                </div>
              );
            })
        )}

        {page === "board" && (
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginBottom: 12, letterSpacing: 1 }}>GLOBAL RANKINGS</div>
            {leaderboard.map(function(p, i) {
              var isMe = p.username === user.username;
              var medals = ["1st", "2nd", "3rd"];
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", marginBottom: 7, background: isMe ? "rgba(232,255,71,0.06)" : "rgba(255,255,255,0.04)", border: isMe ? "1px solid rgba(232,255,71,0.18)" : "1px solid rgba(255,255,255,0.07)", borderRadius: 13 }}>
                  <div style={{ fontSize: 14, fontWeight: 900, width: 32, textAlign: "center", color: i < 3 ? "#e8ff47" : "rgba(255,255,255,0.3)" }}>{medals[i] || ("#" + (i + 1))}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: isMe ? "#e8ff47" : "#fff" }}>{p.username}{isMe && <span style={{ fontSize: 10, opacity: 0.4 }}> (you)</span>}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{p.wins || 0}/{p.total_bets || 0} wins</div>
                  </div>
                  <div style={{ fontWeight: 900, fontSize: 17, color: isMe ? "#e8ff47" : "#fff" }}>{fmt(p.balance)}</div>
                </div>
              );
            })}
            {leaderboard.length === 0 && <Empty icon="(trophy)" title="No players yet" sub="Be the first to sign up!" />}
          </div>
        )}

        {page === "profile" && (
          <div>
            <div style={{ background: "linear-gradient(135deg,rgba(232,255,71,0.07),rgba(232,255,71,0.02))", border: "1px solid rgba(232,255,71,0.12)", borderRadius: 16, padding: 18, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 50, height: 50, borderRadius: "50%", background: "linear-gradient(135deg,#e8ff47,#a3e635)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, color: "#060d1a" }}>{user.username[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 18 }}>{user.username}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Joined {new Date(user.joined).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                {[
                  { l: "Balance", v: fmt(user.balance), c: "#e8ff47" },
                  { l: "Win Rate", v: winRate + "%", c: winRate >= 50 ? "#4ade80" : "#f87171" },
                  { l: "Total Bets", v: bets.length, c: "#60a5fa" },
                  { l: "Wagered", v: fmt(totalWagered), c: "#f87171" },
                  { l: "Won", v: wonBets.length, c: "#4ade80" },
                  { l: "Pending", v: pendingBets.length, c: "#fbbf24" },
                ].map(function(s, i) {
                  return (
                    <div key={i} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "11px 13px" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 3 }}>{s.l}</div>
                      <div style={{ fontSize: 19, fontWeight: 900, color: s.c }}>{s.v}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 15, marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>Profit / Loss</div>
              {[{ l: "Total wagered", v: fmt(totalWagered), c: "#fff" }, { l: "Total won", v: fmt(totalWon), c: "#4ade80" }, { l: "Net P/L", v: fmt(totalWon - totalWagered), c: totalWon >= totalWagered ? "#4ade80" : "#f87171" }].map(function(s, i) {
                return <div key={i} style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 5 }}>{s.l}: <span style={{ color: s.c, fontWeight: 700 }}>{s.v}</span></div>;
              })}
            </div>
            {favLeagues.size > 0 && (
              <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 15, marginBottom: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>Favourite Leagues</div>
                {allLeagues.filter(function(l) { return favLeagues.has(l.id); }).map(function(l) {
                  return (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      {l.logo && <img src={l.logo} alt="" style={{ width: 16, height: 16, objectFit: "contain" }} onError={function(e) { e.target.style.display = "none"; }} />}
                      <span style={{ fontSize: 13, color: l.color, fontWeight: 700 }}>{l.name}</span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{l.country}</span>
                      <button onClick={function() { toggleFavLeague(l.id); }} style={{ marginLeft: "auto", background: "none", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: 10 }}>Remove</button>
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={logout} style={{ width: "100%", padding: 13, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171", borderRadius: 12, fontWeight: 800, cursor: "pointer", fontSize: 14 }}>Log Out</button>
          </div>
        )}
      </div>

      {selectedMatch && <MatchModal match={selectedMatch} onClose={function() { setSelectedMatch(null); }} onBet={handleBet} balance={user.balance} favMatches={favMatches} onToggleFavMatch={toggleFavMatch} />}
      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#0e1628", border: "1px solid " + toast.color + "44", color: toast.color, padding: "11px 20px", borderRadius: 12, fontWeight: 700, fontSize: 13, zIndex: 300, whiteSpace: "nowrap", boxShadow: "0 8px 32px rgba(0,0,0,0.7)", animation: "toastIn 0.25s ease" }}>{toast.msg}</div>}
    </div>
  );
}
