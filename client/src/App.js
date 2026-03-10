import { useState, useEffect, useCallback, useRef } from "react";

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

const fmt = function(n) { return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 }); };
const lcol = function(id) {
  var MAP = {
    "eng.1":"#3b82f6","uefa.champions":"#fbbf24","esp.1":"#ef4444","ger.1":"#f59e0b","ita.1":"#10b981","fra.1":"#8b5cf6",
    "uefa.europa":"#f97316","uefa.europa.conf":"#06b6d4","eng.2":"#60a5fa","esp.2":"#fca5a5","ger.2":"#fcd34d",
    "ita.2":"#6ee7b7","fra.2":"#c4b5fd","ned.1":"#f87171","por.1":"#4ade80","sco.1":"#818cf8",
    "bel.1":"#fb923c","tur.1":"#e879f9","gre.1":"#38bdf8","rus.1":"#a78bfa",
    "eng.fa":"#93c5fd","eng.league_cup":"#86efac","esp.copa_del_rey":"#fda4af","ger.dfb_pokal":"#fde68a",
    "ita.coppa_italia":"#a7f3d0","fra.coupe_de_france":"#ddd6fe",
    "usa.1":"#67e8f9","bra.1":"#bbf7d0","arg.1":"#fef08a","mex.1":"#fed7aa","col.1":"#fecdd3",
    "chi.1":"#e0e7ff","conmebol.libertadores":"#fef3c7","conmebol.sudamericana":"#ede9fe",
    "concacaf.champions":"#cffafe","ksa.1":"#d1fae5","jpn.1":"#fee2e2","chn.1":"#fce7f3",
    "ind.1":"#e0f2fe","afc.champions":"#f0fdf4","caf.champions":"#fef9c3",
    "fifa.world":"#ecfdf5","uefa.euro":"#eff6ff","conmebol.america":"#fff7ed",
    "uefa.nations":"#f5f3ff","fifa.cwc":"#fdf2f8",
    "eng.w.1":"#fce7f3","uefa.wchampions":"#fdf4ff","usa.nwsl":"#f0f9ff","fifa.wwc":"#fef2f2",
  };
  return MAP[String(id)] || "#e8ff47";
};

function parseFixture(f) {
  return {
    id: f.id, fixtureId: f.fixtureId || f.id,
    league: f.league || "Unknown", leagueId: f.leagueId,
    leagueColor: f.leagueColor || lcol(f.leagueId) || "#e8ff47",
    leagueLogo: f.leagueLogo || null, leagueCountry: f.leagueCountry || "",
    home: f.home || "TBA", away: f.away || "TBA",
    homeLogo: f.homeLogo || null, awayLogo: f.awayLogo || null,
    time: f.time || "", kickoffTs: f.kickoffTs || 0,
    status: f.status || "upcoming", elapsed: f.elapsed || null,
    homeScore: f.homeScore != null ? f.homeScore : null,
    awayScore: f.awayScore != null ? f.awayScore : null,
    homeOdds: f.homeOdds || 2.50, drawOdds: f.drawOdds || 3.20, awayOdds: f.awayOdds || 2.80,
  };
}

function getAllMarkets(m) {
  var h = m.homeOdds, d = m.drawOdds, a = m.awayOdds;
  var hf = h < a, bf = Math.abs(h - a) > 1.2;
  return [
    { id:"1x2", label:"Match Result", options:[
      { label: m.home + " Win", odds: h },
      { label: "Draw", odds: d },
      { label: m.away + " Win", odds: a },
    ]},
    { id:"dc", label:"Double Chance", options:[
      { label: m.home + " or Draw", odds: Math.max(1.05, +(h*0.55).toFixed(2)) },
      { label: m.away + " or Draw", odds: Math.max(1.05, +(a*0.55).toFixed(2)) },
      { label: m.home + " or " + m.away, odds: Math.max(1.05, +(d*0.45).toFixed(2)) },
    ]},
    { id:"btts", label:"Both Teams to Score", options:[
      { label:"Yes", odds: bf?1.65:1.80 },
      { label:"No",  odds: bf?2.10:1.95 },
    ]},
    { id:"ou15", label:"Over / Under 1.5 Goals", options:[
      { label:"Over 1.5",  odds:+(Math.max(1.10, 1.35 - (m.homeScore||0)-(m.awayScore||0)*0.1)).toFixed(2) },
      { label:"Under 1.5", odds:+(Math.min(9.00, 3.00 + (m.homeScore||0)+(m.awayScore||0)*0.5)).toFixed(2) },
    ]},
    { id:"ou25", label:"Over / Under 2.5 Goals", options:[
      { label:"Over 2.5",  odds:1.88 },
      { label:"Under 2.5", odds:1.88 },
    ]},
    { id:"ou35", label:"Over / Under 3.5 Goals", options:[
      { label:"Over 3.5",  odds:2.75 },
      { label:"Under 3.5", odds:1.45 },
    ]},
    { id:"ht", label:"Half-Time Result", options:[
      { label: m.home + " HT", odds: Math.max(1.20, +(h*1.35).toFixed(2)) },
      { label:"HT Draw", odds:2.05 },
      { label: m.away + " HT", odds: Math.max(1.20, +(a*1.35).toFixed(2)) },
    ]},
    { id:"cs", label:"Correct Score", options:[
      { label:"1-0", odds:hf?5.50:7.00 },  { label:"2-0", odds:hf?7.00:9.50 },
      { label:"2-1", odds:hf?6.50:8.50 },  { label:"3-0", odds:13.00 },
      { label:"3-1", odds:12.00 },          { label:"3-2", odds:16.00 },
      { label:"1-1", odds:5.00 },           { label:"2-2", odds:9.00 },
      { label:"0-0", odds:6.50 },           { label:"0-1", odds:hf?7.00:5.50 },
      { label:"0-2", odds:hf?9.50:7.00 },  { label:"0-3", odds:13.00 },
      { label:"1-2", odds:hf?8.50:6.50 },  { label:"1-3", odds:12.00 },
      { label:"2-3", odds:16.00 },          { label:"Other", odds:4.50 },
    ]},
    { id:"cards", label:"Total Cards", options:[
      { label:"Over 3.5 cards",   odds:1.90 }, { label:"Under 3.5 cards",  odds:1.85 },
      { label:"Over 4.5 cards",   odds:2.80 }, { label:"Under 4.5 cards",  odds:1.40 },
    ]},
    { id:"corners", label:"Total Corners", options:[
      { label:"Over 9.5 corners",  odds:1.85 }, { label:"Under 9.5 corners",  odds:1.90 },
      { label:"Over 11.5 corners", odds:2.60 }, { label:"Under 11.5 corners", odds:1.45 },
    ]},
  ];
}

function Loader() {
  return <div style={{ textAlign:"center", padding:"30px 0" }}>
    <div style={{ width:24, height:24, border:"3px solid rgba(255,255,255,0.1)", borderTop:"3px solid #e8ff47", borderRadius:"50%", margin:"0 auto", animation:"spin 0.8s linear infinite" }} />
  </div>;
}

function LiveBadge({ elapsed }) {
  return <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:11, color:"#ef4444", fontWeight:800 }}>
    <span style={{ width:6, height:6, borderRadius:"50%", background:"#ef4444", display:"inline-block", animation:"pulse 1.2s infinite" }} />
    {elapsed ? elapsed + "'" : "LIVE"}
  </span>;
}

function PlayerRow({ p }) {
  return <div style={{ display:"flex", alignItems:"center", gap:7, padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
    <div style={{ width:22, height:22, borderRadius:"50%", background:"rgba(255,255,255,0.08)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:800, color:"rgba(255,255,255,0.5)", flexShrink:0 }}>{p.shirtNumber||"-"}</div>
    <span style={{ fontSize:12, flex:1 }}>{p.name}</span>
    {p.position && <span style={{ fontSize:9, color:"rgba(255,255,255,0.3)", padding:"2px 5px", background:"rgba(255,255,255,0.06)", borderRadius:4 }}>{p.position}</span>}
  </div>;
}

// -- Acca Bet Slip --
function BetSlip({ slip, onRemove, onClear, onPlaceAll, balance }) {
  var [stake, setStake] = useState("");
  var [placing, setPlacing] = useState(false);

  var combinedOdds = slip.reduce(function(acc, b) { return Math.round(acc * b.odds * 100) / 100; }, 1);
  var stakeAmt = parseFloat(stake) || 0;
  var potential = stakeAmt > 0 ? Math.round(stakeAmt * combinedOdds * 100) / 100 : 0;

  var placeAcca = function() {
    if (stakeAmt < 1 || stakeAmt > balance) return;
    setPlacing(true);
    // For acca: place as a single bet with all selections combined
    onPlaceAll([{
      key: slip.map(function(b){ return b.key; }).join("+"),
      fixtureId: slip[0].fixtureId,
      matchLabel: slip.length === 1 ? slip[0].matchLabel : slip.length + "-fold Accumulator",
      league: slip[0].league, leagueId: slip[0].leagueId,
      optLabel: slip.map(function(b){ return b.optLabel + " (" + b.matchLabel + ")"; }).join(" | "),
      marketLabel: slip.length === 1 ? slip[0].marketLabel : "Accumulator",
      odds: combinedOdds,
      amount: stakeAmt,
      potential: potential,
      matchTime: slip[0].matchTime,
      isAcca: slip.length > 1,
      legs: slip,
    }]).finally(function(){ setPlacing(false); });
  };

  if (!slip.length) return null;

  return (
    <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, zIndex:150, background:"#0b1526", borderTop:"2px solid #e8ff47", boxShadow:"0 -8px 40px rgba(0,0,0,0.8)" }}>
      <div style={{ padding:"10px 14px 6px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <span style={{ fontWeight:900, fontSize:13, color:"#e8ff47" }}>
            {slip.length === 1 ? "BET SLIP" : slip.length + "-FOLD ACCA"}
          </span>
          {slip.length > 1 && (
            <span style={{ marginLeft:8, fontSize:12, color:"rgba(255,255,255,0.4)" }}>
              Combined odds: <span style={{ color:"#e8ff47", fontWeight:800 }}>{combinedOdds}x</span>
            </span>
          )}
        </div>
        <button onClick={onClear} style={{ background:"none", border:"none", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:11 }}>Clear all</button>
      </div>

      <div style={{ maxHeight:160, overflowY:"auto", padding:"0 14px 6px" }}>
        {slip.map(function(b) {
          var lc = lcol(b.leagueId);
          return (
            <div key={b.key} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", marginBottom:5, background:"rgba(255,255,255,0.04)", borderLeft:"2px solid "+lc, borderRadius:8 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{b.matchLabel} - {b.marketLabel}</div>
                <div style={{ fontWeight:800, fontSize:12, color:"#fff" }}>{b.optLabel}</div>
              </div>
              <span style={{ fontSize:14, fontWeight:900, color:lc, flexShrink:0 }}>{b.odds}x</span>
              <button onClick={function(){ onRemove(b.key); }} style={{ background:"rgba(248,113,113,0.15)", border:"none", color:"#f87171", borderRadius:5, width:20, height:20, cursor:"pointer", fontSize:12, lineHeight:1, flexShrink:0 }}>x</button>
            </div>
          );
        })}
      </div>

      <div style={{ padding:"8px 14px 20px", borderTop:"1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display:"flex", gap:4, marginBottom:7 }}>
          {[5,10,25,50].map(function(q) {
            return <button key={q} onClick={function(){ setStake(String(Math.min(q, balance))); }} style={{ flex:1, padding:"5px 0", borderRadius:7, border:stake===String(Math.min(q,balance))?"1px solid #e8ff47":"1px solid rgba(255,255,255,0.1)", background:stake===String(Math.min(q,balance))?"rgba(232,255,71,0.1)":"rgba(255,255,255,0.04)", color:stake===String(Math.min(q,balance))?"#e8ff47":"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:12, fontWeight:700 }}>${q}</button>;
          })}
          <button onClick={function(){ setStake(String(balance)); }} style={{ flex:1, padding:"5px 0", borderRadius:7, border:"1px solid rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.04)", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:11, fontWeight:700 }}>All</button>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <div style={{ flex:1, position:"relative" }}>
            <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"rgba(255,255,255,0.4)", fontSize:13 }}>$</span>
            <input value={stake} onChange={function(e){ setStake(e.target.value); }} type="number" placeholder="Stake" style={{ width:"100%", padding:"10px 10px 10px 24px", borderRadius:8, background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)", color:"#fff", fontSize:15, outline:"none", fontWeight:700, boxSizing:"border-box" }} />
          </div>
          <div style={{ textAlign:"center", minWidth:72 }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)" }}>WIN</div>
            <div style={{ fontSize:15, fontWeight:900, color:potential>0?"#4ade80":"rgba(255,255,255,0.2)" }}>{potential>0?fmt(potential):"--"}</div>
          </div>
          <button onClick={placeAcca} disabled={placing||stakeAmt<1||stakeAmt>balance} style={{ padding:"10px 18px", background:(placing||stakeAmt<1||stakeAmt>balance)?"rgba(255,255,255,0.08)":"#e8ff47", color:(placing||stakeAmt<1||stakeAmt>balance)?"rgba(255,255,255,0.3)":"#060d1a", border:"none", borderRadius:9, fontWeight:900, cursor:(placing||stakeAmt<1||stakeAmt>balance)?"not-allowed":"pointer", fontSize:14 }}>
            {placing ? "..." : "BET"}
          </button>
        </div>
      </div>
    </div>
  );
}


function MatchModal({ match: m, onClose, onAddToBetSlip, slip, balance, favMatches, onToggleFavMatch }) {
  var lc = m.leagueColor || "#e8ff47";
  var isLive = m.status === "live";
  var isFT   = m.status === "finished";
  var isFav  = favMatches.has(m.id);
  var markets = getAllMarkets(m);

  var [tab,        setTab]        = useState("markets");
  var [detail,     setDetail]     = useState(null);
  var [detailLoad, setDetailLoad] = useState(false);
  var [detailErr,  setDetailErr]  = useState(null);

  var loadDetail = useCallback(function() {
    setDetailLoad(true); setDetailErr(null);
    api("/fixtures/" + m.fixtureId + "/stats")
      .then(function(d) { setDetail(d); })
      .catch(function(e) { setDetailErr(e.message); })
      .finally(function() { setDetailLoad(false); });
  }, [m.fixtureId]);

  useEffect(function() {
    if (tab === "markets") return;
    if (!detail && !detailLoad) loadDetail();
    if (!isLive) return;
    var t = setInterval(loadDetail, 30000);
    return function() { clearInterval(t); };
  }, [tab, isLive]);

  var goals      = detail && detail.events ? detail.events.filter(function(e) { return e.type === "Goal"; }) : [];
  var homeLineup = (detail && detail.lineups && detail.lineups.home && detail.lineups.home.lineup) || [];
  var awayLineup = (detail && detail.lineups && detail.lineups.away && detail.lineups.away.lineup) || [];
  var homeBench  = (detail && detail.lineups && detail.lineups.home && detail.lineups.home.bench)  || [];
  var awayBench  = (detail && detail.lineups && detail.lineups.away && detail.lineups.away.bench)  || [];
  var homeForm   = detail && detail.lineups && detail.lineups.home && detail.lineups.home.formation;
  var awayForm   = detail && detail.lineups && detail.lineups.away && detail.lineups.away.formation;
  var hasLineups = homeLineup.length > 0 || awayLineup.length > 0;

  var addBet = function(market, opt) {
    var key = m.fixtureId + "|" + market.id + "|" + opt.label;
    onAddToBetSlip({
      key, fixtureId: m.fixtureId, matchLabel: m.home + " vs " + m.away,
      league: m.league, leagueId: m.leagueId,
      marketId: market.id, marketLabel: market.label,
      optLabel: opt.label, odds: opt.odds, matchTime: m.time,
    });
  };

  var slipKeys = new Set(slip.map(function(b) { return b.key; }));

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={onClose}>
      <div style={{ width:"100%", maxWidth:480, background:"#0b1120", borderRadius:"22px 22px 0 0", maxHeight:"92vh", display:"flex", flexDirection:"column" }} onClick={function(e){ e.stopPropagation(); }}>

        <div style={{ padding:"16px 16px 0", background:"linear-gradient(160deg,"+lc+"20,transparent 60%)", flexShrink:0 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              {m.leagueLogo && <img src={m.leagueLogo} alt="" style={{ width:16, height:16, objectFit:"contain" }} onError={function(e){ e.target.style.display="none"; }} />}
              <span style={{ fontSize:11, color:lc, fontWeight:800 }}>{m.league}</span>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              {isLive && <LiveBadge elapsed={m.elapsed} />}
              {isFT   && <span style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontWeight:700 }}>FT</span>}
              <button onClick={function(){ onToggleFavMatch(m.id); }} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", padding:0, color:isFav?"#e8ff47":"rgba(255,255,255,0.3)", lineHeight:1 }}>{isFav?"*":"o"}</button>
              <button onClick={onClose} style={{ background:"rgba(255,255,255,0.07)", border:"none", color:"rgba(255,255,255,0.6)", borderRadius:8, padding:"4px 12px", cursor:"pointer", fontSize:14 }}>X</button>
            </div>
          </div>

          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingBottom:14 }}>
            <div style={{ flex:1, textAlign:"center" }}>
              {m.homeLogo && <img src={m.homeLogo} alt="" style={{ width:42, height:42, objectFit:"contain", marginBottom:5 }} onError={function(e){ e.target.style.display="none"; }} />}
              <div style={{ fontWeight:900, fontSize:13 }}>{m.home}</div>
            </div>
            <div style={{ textAlign:"center", minWidth:90 }}>
              {(isLive||isFT)
                ? <div>
                    <div style={{ fontSize:34, fontWeight:900, letterSpacing:4 }}>{m.homeScore} - {m.awayScore}</div>
                    {isLive && m.elapsed && <div style={{ fontSize:12, color:"#ef4444", fontWeight:800, marginTop:2 }}>{m.elapsed}"</div>}
                  </div>
                : <div><div style={{ fontSize:13, color:lc, fontWeight:900 }}>VS</div><div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginTop:3 }}>{m.time}</div></div>
              }
            </div>
            <div style={{ flex:1, textAlign:"center" }}>
              {m.awayLogo && <img src={m.awayLogo} alt="" style={{ width:42, height:42, objectFit:"contain", marginBottom:5 }} onError={function(e){ e.target.style.display="none"; }} />}
              <div style={{ fontWeight:900, fontSize:13 }}>{m.away}</div>
            </div>
          </div>

          {slip.length > 0 && (
            <div style={{ marginBottom:8, padding:"5px 10px", background:"rgba(232,255,71,0.08)", borderRadius:8, fontSize:11, color:"#e8ff47", fontWeight:700, textAlign:"center" }}>
              {slip.length} bet{slip.length>1?"s":""} in slip - scroll down to place
            </div>
          )}

          <div style={{ display:"flex", gap:2 }}>
            {["markets","lineups","stats"].map(function(t) {
              return <button key={t} onClick={function(){ setTab(t); }} style={{ padding:"8px 16px", background:"none", border:"none", borderBottom:tab===t?"2px solid "+lc:"2px solid transparent", color:tab===t?"#fff":"rgba(255,255,255,0.35)", cursor:"pointer", fontWeight:700, fontSize:12, textTransform:"capitalize" }}>{t}</button>;
            })}
          </div>
        </div>

        <div style={{ flex:1, overflowY:"auto" }}>

          {tab==="markets" && (
            <div style={{ padding:"0 14px 16px" }}>
              {markets.map(function(market) {
                var cols = market.options.length===2?"1fr 1fr":market.options.length===3?"1fr 1fr 1fr":"1fr 1fr 1fr 1fr";
                return (
                  <div key={market.id} style={{ marginTop:14 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.35)", letterSpacing:1, marginBottom:7, textTransform:"uppercase" }}>{market.label}</div>
                    <div style={{ display:"grid", gridTemplateColumns:cols, gap:6 }}>
                      {market.options.map(function(opt,i) {
                        var key = m.fixtureId+"|"+market.id+"|"+opt.label;
                        var isSel = slipKeys.has(key);
                        return <button key={i} onClick={function(){ addBet(market, opt); }} style={{ padding:"9px 4px", borderRadius:10, cursor:"pointer", textAlign:"center", border:isSel?"2px solid "+lc:"1px solid rgba(255,255,255,0.09)", background:isSel?lc+"22":"rgba(255,255,255,0.04)", transition:"all 0.12s", position:"relative" }}>
                          {isSel && <span style={{ position:"absolute", top:3, right:4, fontSize:8, color:lc, fontWeight:900 }}>IN SLIP</span>}
                          <div style={{ fontSize:9, color:isSel?lc:"rgba(255,255,255,0.4)", marginBottom:4, lineHeight:1.3 }}>{opt.label}</div>
                          <div style={{ fontSize:16, fontWeight:900, color:isSel?lc:"#fff" }}>{opt.odds}x</div>
                        </button>;
                      })}
                    </div>
                  </div>
                );
              })}
              <div style={{ height:20 }} />
            </div>
          )}

          {tab==="lineups" && (
            <div style={{ padding:14 }}>
              {detailLoad && !detail && <Loader />}
              {detailErr && <div style={{ color:"#f87171", fontSize:12, textAlign:"center", padding:20 }}>{detailErr}</div>}
              {!detailLoad && !detailErr && !hasLineups && (
                <div style={{ textAlign:"center", padding:"30px 20px" }}>
                  <div style={{ fontSize:36, marginBottom:12 }}>&#128203;</div>
                  <div style={{ fontWeight:700, color:"rgba(255,255,255,0.5)", marginBottom:8 }}>
                    {!isLive&&!isFT ? "Lineups not announced yet" : "No lineup data available"}
                  </div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.28)" }}>
                    {!isLive&&!isFT ? "Usually published ~1 hour before kick-off" : "Not available on the free API tier"}
                  </div>
                </div>
              )}
              {hasLineups && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:800, color:lc, marginBottom:8 }}>{m.home}{homeForm&&" ("+homeForm+")"}</div>
                    {homeLineup.map(function(p,i){ return <PlayerRow key={i} p={p} />; })}
                    {homeBench.length>0 && <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:10, marginBottom:5, fontWeight:800 }}>BENCH</div>}
                    {homeBench.map(function(p,i){ return <PlayerRow key={"b"+i} p={p} />; })}
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:800, color:lc, marginBottom:8 }}>{m.away}{awayForm&&" ("+awayForm+")"}</div>
                    {awayLineup.map(function(p,i){ return <PlayerRow key={i} p={p} />; })}
                    {awayBench.length>0 && <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:10, marginBottom:5, fontWeight:800 }}>BENCH</div>}
                    {awayBench.map(function(p,i){ return <PlayerRow key={"b"+i} p={p} />; })}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab==="stats" && (
            <div style={{ padding:14 }}>
              {detailLoad && !detail && <Loader />}
              {detailErr && <div style={{ color:"#f87171", fontSize:12, textAlign:"center", padding:20 }}>{detailErr}</div>}
              {!isLive&&!isFT&&!detailLoad && (
                <div style={{ textAlign:"center", padding:"30px 16px" }}>
                  <div style={{ fontSize:32, marginBottom:10 }}>&#9201;</div>
                  <div style={{ fontWeight:700, color:"rgba(255,255,255,0.5)", marginBottom:6 }}>Match not started yet</div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.28)" }}>{m.time}</div>
                </div>
              )}
              {(isLive||isFT) && detail && (
                <div>
                  {detail.fullTime && (
                    <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:12, padding:"12px 16px", marginBottom:14 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ fontSize:12, fontWeight:700 }}>{m.home}</span>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ fontSize:28, fontWeight:900, letterSpacing:4 }}>{detail.fullTime.home} - {detail.fullTime.away}</div>
                          {isLive && detail.elapsed && <div style={{ fontSize:12, color:"#ef4444", fontWeight:800, marginTop:2 }}>{detail.elapsed}"</div>}
                        </div>
                        <span style={{ fontSize:12, fontWeight:700 }}>{m.away}</span>
                      </div>
                      {detail.halfTime && <div style={{ textAlign:"center", fontSize:10, color:"rgba(255,255,255,0.3)", marginTop:4 }}>HT: {detail.halfTime.home} - {detail.halfTime.away}</div>}
                      {detail.venue && <div style={{ textAlign:"center", fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:3 }}>{detail.venue}{detail.attendance?" - "+detail.attendance.toLocaleString()+" att":""}</div>}
                      {detail.referees && <div style={{ textAlign:"center", fontSize:10, color:"rgba(255,255,255,0.2)", marginTop:2 }}>Ref: {detail.referees}</div>}
                    </div>
                  )}
                  {goals.length>0 && (
                    <div style={{ marginBottom:14 }}>
                      <div style={{ fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.35)", letterSpacing:1, marginBottom:8 }}>GOALS</div>
                      {goals.map(function(g,i) {
                        return <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,0.05)", fontSize:12 }}>
                          <span style={{ fontSize:14 }}>&#9917;</span>
                          <div style={{ flex:1 }}>
                            <span style={{ fontWeight:700 }}>{g.player&&g.player.name}</span>
                            <span style={{ color:"rgba(255,255,255,0.35)", fontSize:11, marginLeft:6 }}>{g.team&&g.team.name}</span>
                          </div>
                          <span style={{ color:lc, fontWeight:800, fontSize:13 }}>{g.time&&g.time.elapsed}'</span>
                        </div>;
                      })}
                    </div>
                  )}
                  {goals.length===0 && <div style={{ textAlign:"center", padding:16, color:"rgba(255,255,255,0.25)", fontSize:12 }}>No goals yet</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AuthScreen({ onLogin }) {
  var [mode,setMode]           = useState("login");
  var [username,setUsername]   = useState("");
  var [password,setPassword]   = useState("");
  var [error,setError]         = useState("");
  var [loading,setLoading]     = useState(false);
  var handle = function() {
    if (!username.trim()||!password.trim()) { setError("Fill in all fields"); return; }
    setLoading(true); setError("");
    api("/auth/"+mode, { method:"POST", body:{ username, password } })
      .then(function(d){ localStorage.setItem("bp_token",d.token); onLogin(d.user); })
      .catch(function(e){ setError(e.message); })
      .finally(function(){ setLoading(false); });
  };
  var inp = { width:"100%", padding:"13px 16px", borderRadius:10, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", color:"#fff", fontSize:15, outline:"none", boxSizing:"border-box", marginBottom:12, fontFamily:"Trebuchet MS,sans-serif" };
  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#050a18,#0c1428)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"Trebuchet MS,sans-serif" }}>
      <div style={{ marginBottom:36, textAlign:"center" }}>
        <div style={{ fontSize:52, fontWeight:900, letterSpacing:-3, color:"#fff", lineHeight:1 }}>BET<span style={{ color:"#e8ff47" }}>PLAY</span></div>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", marginTop:8, letterSpacing:2 }}>FANTASY BETTING - NO REAL MONEY</div>
      </div>
      <div style={{ width:"100%", maxWidth:360, background:"rgba(255,255,255,0.04)", borderRadius:22, padding:28, border:"1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display:"flex", gap:4, marginBottom:22, background:"rgba(255,255,255,0.05)", borderRadius:12, padding:4 }}>
          {["login","signup"].map(function(mv) {
            return <button key={mv} onClick={function(){ setMode(mv); setError(""); }} style={{ flex:1, padding:"9px", background:mode===mv?"#e8ff47":"none", color:mode===mv?"#060d1a":"rgba(255,255,255,0.45)", border:"none", borderRadius:9, cursor:"pointer", fontWeight:800, fontSize:13 }}>{mv==="login"?"Log In":"Sign Up"}</button>;
          })}
        </div>
        <input style={inp} placeholder="Username" value={username} onChange={function(e){ setUsername(e.target.value); }} />
        <input style={inp} type="password" placeholder="Password" value={password} onChange={function(e){ setPassword(e.target.value); }} onKeyDown={function(e){ if(e.key==="Enter") handle(); }} />
        {error && <div style={{ color:"#f87171", fontSize:12, marginBottom:10, padding:"8px 12px", background:"rgba(248,113,113,0.08)", borderRadius:8 }}>{error}</div>}
        <button onClick={handle} disabled={loading} style={{ width:"100%", padding:"14px", background:"#e8ff47", color:"#060d1a", border:"none", borderRadius:11, fontWeight:900, fontSize:16, cursor:"pointer", opacity:loading?0.7:1 }}>
          {loading?"...":mode==="login"?"Log In":"Create Account"}
        </button>
        {mode==="signup" && <div style={{ marginTop:14, fontSize:11, color:"rgba(255,255,255,0.28)", textAlign:"center" }}>Start with <strong style={{ color:"#e8ff47" }}>$100.00</strong> free coins</div>}
      </div>
    </div>
  );
}

export default function App() {
  var [user,setUser]                   = useState(null);
  var [page,setPage]                   = useState("matches");
  var [matches,setMatches]             = useState([]);
  var [loading,setLoading]             = useState(false);
  var [fetchError,setFetchError]       = useState(null);
  var [selectedMatch,setSelectedMatch] = useState(null);
  var [toast,setToast]                 = useState(null);
  var [adCooldown,setAdCooldown]       = useState(0);
  var [leaderboard,setLeaderboard]     = useState([]);
  var [activeLeague,setActiveLeague]   = useState("live");
  var [search,setSearch]               = useState("");
  var [betSlip,setBetSlip]             = useState([]);

  var [favLeagues,setFavLeagues] = useState(function(){ return new Set(JSON.parse(localStorage.getItem("bp_favLeagues")||"[]")); });
  var [favMatches,setFavMatches] = useState(function(){ return new Set(JSON.parse(localStorage.getItem("bp_favMatches")||"[]")); });
  var [favTeams,setFavTeams]     = useState(function(){ return new Set(JSON.parse(localStorage.getItem("bp_favTeams")||"[]")); });

  var refreshRef = useRef(null);

  useEffect(function() {
    var token = localStorage.getItem("bp_token");
    if (!token) return;
    api("/me").then(function(d){ setUser(d); }).catch(function(){ localStorage.removeItem("bp_token"); });
  }, []);

  useEffect(function() {
    if (adCooldown<=0) return;
    var t = setTimeout(function(){ setAdCooldown(function(c){ return c-1; }); }, 1000);
    return function(){ clearTimeout(t); };
  }, [adCooldown]);

  var showToast = useCallback(function(msg, color) {
    setToast({ msg, color:color||"#e8ff47" });
    setTimeout(function(){ setToast(null); }, 3500);
  }, []);

  var toggleFavLeague = useCallback(function(id) {
    setFavLeagues(function(prev) { var n=new Set(prev); n.has(id)?n.delete(id):n.add(id); localStorage.setItem("bp_favLeagues",JSON.stringify(Array.from(n))); return n; });
  }, []);
  var toggleFavMatch = useCallback(function(id) {
    setFavMatches(function(prev) { var n=new Set(prev); n.has(id)?n.delete(id):n.add(id); localStorage.setItem("bp_favMatches",JSON.stringify(Array.from(n))); return n; });
  }, []);
  var toggleFavTeam = useCallback(function(name) {
    setFavTeams(function(prev) { var n=new Set(prev); n.has(name)?n.delete(name):n.add(name); localStorage.setItem("bp_favTeams",JSON.stringify(Array.from(n))); return n; });
  }, []);

  var fetchMatches = useCallback(function(silent) {
    if (!silent) { setLoading(true); setFetchError(null); }
    api("/fixtures")
      .then(function(data){
        if (data.loading) {
          setFetchError("loading");
          setTimeout(function(){ fetchMatches(false); }, 5000);
          setLoading(false);
          return;
        }
        setMatches((data.response||[]).map(parseFixture));
        setFetchError(null);
        setLoading(false);
      })
      .catch(function(e){ setLoading(false); if(!silent) setFetchError(e.message); });
  }, []);

  var refreshUser = useCallback(function() {
    api("/me").then(function(d){ setUser(d); }).catch(function(){});
  }, []);

  useEffect(function() {
    if (!user) return;
    fetchMatches();
    api("/leaderboard").then(function(d){ setLeaderboard(d); }).catch(function(){});
    refreshRef.current = setInterval(function(){ fetchMatches(true); refreshUser(); }, 30000);
    return function(){ clearInterval(refreshRef.current); };
  }, [user]);

  var addToBetSlip = useCallback(function(bet) {
    setBetSlip(function(prev) {
      // If exact same selection: toggle off
      var exact = prev.find(function(b){ return b.key===bet.key; });
      if (exact) return prev.filter(function(b){ return b.key!==bet.key; });
      // If same fixture+market but different option: replace (can't pick Home Win AND Draw)
      var sameMarket = prev.find(function(b){ return b.fixtureId===bet.fixtureId && b.marketId===bet.marketId; });
      if (sameMarket) return prev.map(function(b){ return (b.fixtureId===bet.fixtureId&&b.marketId===bet.marketId)?bet:b; });
      // Different market or different match: add to slip
      return [...prev, bet];
    });
  }, []);

  var removeFromSlip = useCallback(function(key) {
    setBetSlip(function(prev){ return prev.filter(function(b){ return b.key!==key; }); });
  }, []);

  var placeAllBets = useCallback(function(bets) {
    // bets is always a single-item array (the acca bet)
    var b = bets[0];
    return api("/bet", { method:"POST", body:{
      fixtureId: b.fixtureId, matchLabel: b.matchLabel,
      league: b.league, leagueId: b.leagueId,
      optionLabel: b.optLabel, market: b.marketLabel,
      amount: b.amount, odds: b.odds, potential: b.potential, matchTime: b.matchTime,
    }}).then(function(d) {
      setUser(function(u){ return Object.assign({},u,{ balance:d.balance, bets:(u.bets||[]).concat([d.bet]) }); });
      setBetSlip([]);
      var label = b.isAcca ? b.legs.length+"-fold acca placed!" : "Bet placed!";
      showToast(label + " Win: " + fmt(b.potential), "#4ade80");
      setTimeout(refreshUser, 5000);
    }).catch(function(e){ showToast(e.message, "#f87171"); });
  }, []);

  var watchAd = function() {
    if (adCooldown>0) return;
    setAdCooldown(30);
    api("/adreward", { method:"POST" })
      .then(function(d){ setUser(function(u){ return Object.assign({},u,{balance:d.balance}); }); showToast("+$10 added!", "#4ade80"); })
      .catch(function(e){ showToast(e.message, "#f87171"); });
  };

  var logout = function(){ localStorage.removeItem("bp_token"); setUser(null); setMatches([]); setBetSlip([]); };

  if (!user) return <AuthScreen onLogin={function(u){ setUser(u); }} />;

  var bets         = user.bets||[];
  var liveMatches  = matches.filter(function(m){ return m.status==="live"; });
  var pendingBets  = bets.filter(function(b){ return b.status==="pending"; });
  var wonBets      = bets.filter(function(b){ return b.status==="won"; });
  var settledBets  = bets.filter(function(b){ return b.status!=="pending"; });
  var winRate      = settledBets.length>0?Math.round(wonBets.length/settledBets.length*100):0;
  var totalWagered = bets.reduce(function(s,b){ return s+b.amount; },0);
  var totalWon     = wonBets.reduce(function(s,b){ return s+b.potential; },0);

  var leagueMap = new Map();
  matches.forEach(function(m) {
    if (!leagueMap.has(m.leagueId)) leagueMap.set(m.leagueId, { id:m.leagueId, name:m.league, color:m.leagueColor, logo:m.leagueLogo, country:m.leagueCountry, count:0, liveCount:0 });
    var l=leagueMap.get(m.leagueId); l.count++;
    if (m.status==="live") l.liveCount++;
  });
  var allLeagues = Array.from(leagueMap.values()).sort(function(a,b) {
    if (favLeagues.has(a.id)&&!favLeagues.has(b.id)) return -1;
    if (favLeagues.has(b.id)&&!favLeagues.has(a.id)) return 1;
    return b.liveCount-a.liveCount||a.name.localeCompare(b.name);
  });

  var sl = search.toLowerCase();
  var rightMatches;
  if (activeLeague==="live") rightMatches = liveMatches;
  else if (activeLeague==="favorites") rightMatches = matches.filter(function(m){ return favMatches.has(m.id)||favTeams.has(m.home)||favTeams.has(m.away); });
  else rightMatches = matches.filter(function(m){ return m.leagueId===activeLeague; });
  if (search) rightMatches = rightMatches.filter(function(m){ return m.home.toLowerCase().includes(sl)||m.away.toLowerCase().includes(sl); });

  var TabBtn = function(p) {
    return <button onClick={function(){ setPage(p.id); }} style={{ flex:1, padding:"9px 0", background:page===p.id?"#e8ff47":"transparent", color:page===p.id?"#060d1a":"rgba(255,255,255,0.4)", border:"none", cursor:"pointer", fontWeight:800, fontSize:11, borderRadius:9 }}>{p.label}</button>;
  };

  var MatchCard = function(p) {
    var m=p.m, lc=m.leagueColor;
    var isLive=m.status==="live", isFT=m.status==="finished";
    var isFavMatch=favMatches.has(m.id);
    var isFavHome=favTeams.has(m.home), isFavAway=favTeams.has(m.away);
    return (
      <div style={{ background:"rgba(255,255,255,0.04)", borderLeft:"3px solid "+lc, border:"1px solid rgba(255,255,255,0.07)", borderRadius:13, padding:"12px 13px", marginBottom:8 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            {m.leagueLogo && <img src={m.leagueLogo} alt="" style={{ width:14, height:14, objectFit:"contain" }} onError={function(e){ e.target.style.display="none"; }} />}
            <span style={{ fontSize:10, color:lc, fontWeight:800 }}>{m.league}</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            {isLive ? <LiveBadge elapsed={m.elapsed} /> : <span style={{ fontSize:10, fontWeight:700, color:isFT?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.3)" }}>{isFT?"FT":m.time}</span>}
            <button onClick={function(){ toggleFavMatch(m.id); }} style={{ background:"none", border:"none", fontSize:13, cursor:"pointer", padding:0, color:isFavMatch?"#e8ff47":"rgba(255,255,255,0.2)" }}>{isFavMatch?"*":"o"}</button>
          </div>
        </div>
        <div onClick={function(){ setSelectedMatch(m); }} style={{ cursor:"pointer" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, flex:1 }}>
              {m.homeLogo && <img src={m.homeLogo} alt="" style={{ width:20, height:20, objectFit:"contain" }} onError={function(e){ e.target.style.display="none"; }} />}
              <span style={{ fontWeight:800, fontSize:13, color:isFavHome?"#e8ff47":"#fff" }}>{m.home}</span>
              <button onClick={function(e){ e.stopPropagation(); toggleFavTeam(m.home); }} style={{ background:"none", border:"none", fontSize:10, cursor:"pointer", padding:0, color:isFavHome?"#e8ff47":"rgba(255,255,255,0.15)" }}>{isFavHome?"*":"o"}</button>
            </div>
            {(isLive||isFT)
              ? <div style={{ fontSize:22, fontWeight:900, letterSpacing:2, minWidth:60, textAlign:"center" }}>{m.homeScore} - {m.awayScore}</div>
              : <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", padding:"3px 8px", background:"rgba(255,255,255,0.04)", borderRadius:5 }}>VS</div>
            }
            <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, justifyContent:"flex-end" }}>
              <button onClick={function(e){ e.stopPropagation(); toggleFavTeam(m.away); }} style={{ background:"none", border:"none", fontSize:10, cursor:"pointer", padding:0, color:isFavAway?"#e8ff47":"rgba(255,255,255,0.15)" }}>{isFavAway?"*":"o"}</button>
              <span style={{ fontWeight:800, fontSize:13, color:isFavAway?"#e8ff47":"#fff" }}>{m.away}</span>
              {m.awayLogo && <img src={m.awayLogo} alt="" style={{ width:20, height:20, objectFit:"contain" }} onError={function(e){ e.target.style.display="none"; }} />}
            </div>
          </div>
          {!isFT && (
            <div style={{ display:"flex", gap:5, marginTop:10 }}>
              {[{l:m.home,o:m.homeOdds},{l:"Draw",o:m.drawOdds},{l:m.away,o:m.awayOdds}].map(function(opt,i){
                return <div key={i} style={{ flex:1, padding:"6px 3px", background:"rgba(255,255,255,0.05)", borderRadius:7, border:"1px solid rgba(255,255,255,0.07)", textAlign:"center" }}>
                  <div style={{ fontSize:8, color:"rgba(255,255,255,0.35)", marginBottom:2, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{opt.l}</div>
                  <div style={{ fontSize:14, fontWeight:900, color:isLive?"#e8ff47":"#fff" }}>{opt.o}</div>
                </div>;
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  var slipCount = betSlip.length;
  var bottomPad = slipCount > 0 ? 320 : 80;

  return (
    <div style={{ minHeight:"100vh", background:"#080d1a", fontFamily:"Trebuchet MS,sans-serif", color:"#fff", maxWidth:480, margin:"0 auto" }}>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}} @keyframes toastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} ::-webkit-scrollbar{width:2px} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1)} input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none} input[type=number]{-moz-appearance:textfield}"}</style>

      <div style={{ padding:"14px 14px 0", borderBottom:"1px solid rgba(255,255,255,0.07)", position:"sticky", top:0, background:"rgba(8,13,26,0.97)", backdropFilter:"blur(20px)", zIndex:100 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:22, fontWeight:900, letterSpacing:-1.5 }}>BET<span style={{ color:"#e8ff47" }}>PLAY</span></span>
              {liveMatches.length>0 && <span style={{ fontSize:10, background:"#ef4444", color:"#fff", borderRadius:6, padding:"2px 7px", fontWeight:800 }}>{liveMatches.length} LIVE</span>}
              {slipCount>0 && <span style={{ fontSize:10, background:"#e8ff47", color:"#060d1a", borderRadius:6, padding:"2px 7px", fontWeight:800 }}>{slipCount} BET{slipCount>1?"S":""}</span>}
            </div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginTop:1 }}>Hi, {user.username}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)" }}>BALANCE</div>
              <div style={{ fontSize:22, fontWeight:900, color:"#e8ff47" }}>{fmt(user.balance)}</div>
            </div>
            <button onClick={logout} style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", color:"rgba(255,255,255,0.35)", borderRadius:8, padding:"6px 10px", cursor:"pointer", fontSize:11 }}>Exit</button>
          </div>
        </div>
        <button onClick={watchAd} disabled={adCooldown>0} style={{ width:"100%", marginTop:9, padding:"8px", background:adCooldown>0?"transparent":"rgba(74,222,128,0.08)", border:adCooldown>0?"1px solid rgba(255,255,255,0.05)":"1px solid rgba(74,222,128,0.2)", borderRadius:9, color:adCooldown>0?"rgba(255,255,255,0.18)":"#4ade80", cursor:adCooldown>0?"not-allowed":"pointer", fontWeight:700, fontSize:12 }}>
          {adCooldown>0?"Next +$10 in "+adCooldown+"s":"Watch Ad - Get $10 FREE"}
        </button>
        <div style={{ display:"flex", gap:3, marginTop:9, background:"rgba(255,255,255,0.04)", borderRadius:11, padding:3 }}>
          <TabBtn id="matches" label="Matches" />
          <TabBtn id="mybets"  label={"Bets"+(pendingBets.length>0?" ("+pendingBets.length+")":"")} />
          <TabBtn id="board"   label="Ranks" />
          <TabBtn id="profile" label="Profile" />
        </div>
      </div>

      <div style={{ padding:"12px 12px", paddingBottom:bottomPad }}>

        {page==="matches" && (
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ width:68, flexShrink:0, overflowY:"auto", maxHeight:"calc(100vh - 180px)" }}>
              <div onClick={function(){ setActiveLeague("live"); }} style={{ marginBottom:5, padding:"7px 3px", borderRadius:10, cursor:"pointer", textAlign:"center", background:activeLeague==="live"?"rgba(239,68,68,0.14)":"rgba(255,255,255,0.04)", border:activeLeague==="live"?"1px solid rgba(239,68,68,0.35)":"1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize:9, fontWeight:800, color:activeLeague==="live"?"#ef4444":"rgba(255,255,255,0.4)" }}>LIVE</div>
                {liveMatches.length>0 && <div style={{ fontSize:11, color:"#ef4444", fontWeight:900 }}>{liveMatches.length}</div>}
              </div>
              <div onClick={function(){ setActiveLeague("favorites"); }} style={{ marginBottom:5, padding:"7px 3px", borderRadius:10, cursor:"pointer", textAlign:"center", background:activeLeague==="favorites"?"rgba(232,255,71,0.1)":"rgba(255,255,255,0.04)", border:activeLeague==="favorites"?"1px solid rgba(232,255,71,0.25)":"1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize:9, fontWeight:800, color:activeLeague==="favorites"?"#e8ff47":"rgba(255,255,255,0.4)" }}>FAV</div>
              </div>
              {allLeagues.map(function(l) {
                var isActive=activeLeague===l.id, lc=l.color, isFav=favLeagues.has(l.id);
                return (
                  <div key={l.id} style={{ marginBottom:5, position:"relative" }}>
                    <div onClick={function(){ setActiveLeague(l.id); }} style={{ padding:"7px 3px", borderRadius:10, cursor:"pointer", textAlign:"center", background:isActive?lc+"18":"rgba(255,255,255,0.04)", border:isActive?"1px solid "+lc+"44":"1px solid rgba(255,255,255,0.06)" }}>
                      {l.logo
                        ? <img src={l.logo} alt={l.name} style={{ width:24, height:24, objectFit:"contain", display:"block", margin:"0 auto" }} onError={function(e){ e.target.style.display="none"; }} />
                        : <div style={{ width:24, height:24, background:lc, borderRadius:"50%", margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:"#000" }}>{l.name[0]}</div>
                      }
                      <div style={{ fontSize:7.5, color:isActive?lc:"rgba(255,255,255,0.35)", marginTop:3, lineHeight:1.2, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{l.name}</div>
                      {l.liveCount>0 && <div style={{ fontSize:7, color:"#ef4444", fontWeight:800 }}>{l.liveCount} live</div>}
                    </div>
                    <button onClick={function(e){ e.stopPropagation(); toggleFavLeague(l.id); }} style={{ position:"absolute", top:2, right:2, background:"none", border:"none", fontSize:9, cursor:"pointer", padding:0, color:isFav?"#e8ff47":"rgba(255,255,255,0.18)" }}>{isFav?"*":"o"}</button>
                  </div>
                );
              })}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <input value={search} onChange={function(e){ setSearch(e.target.value); }} placeholder="Search teams..." style={{ width:"100%", padding:"8px 12px", borderRadius:9, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", color:"#fff", fontSize:12, outline:"none", marginBottom:10, boxSizing:"border-box" }} />
              {fetchError && fetchError !== "loading" && <div style={{ padding:"10px 12px", background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.2)", borderRadius:10, marginBottom:10, fontSize:11, color:"#f87171", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span>{fetchError}</span>
                <button onClick={function(){ fetchMatches(false); }} style={{ background:"none", border:"1px solid #f87171", color:"#f87171", borderRadius:5, padding:"2px 8px", cursor:"pointer", fontSize:10 }}>Retry</button>
              </div>}
              {fetchError === "loading" && <div style={{ padding:"16px 12px", background:"rgba(232,255,71,0.05)", border:"1px solid rgba(232,255,71,0.15)", borderRadius:10, marginBottom:10, textAlign:"center" }}>
                <div style={{ width:18, height:18, border:"2px solid rgba(232,255,71,0.15)", borderTop:"2px solid #e8ff47", borderRadius:"50%", margin:"0 auto 8px", animation:"spin 0.8s linear infinite" }} />
                <div style={{ fontSize:12, color:"#e8ff47", fontWeight:700 }}>Loading matches...</div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginTop:3 }}>Fetching live data, ready in ~20s</div>
              </div>}
              {loading && <Loader />}
              {!loading && matches.length===0 && !fetchError && (
                <div style={{ textAlign:"center", padding:"40px 16px" }}>
                  <Loader />
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", marginTop:12 }}>Loading matches... (~40s on first load)</div>
                </div>
              )}
              {!loading && rightMatches.length===0 && matches.length>0 && !fetchError && (
                <div style={{ textAlign:"center", padding:"40px 16px" }}>
                  <div style={{ fontWeight:700, color:"rgba(255,255,255,0.4)", marginBottom:6 }}>
                    {activeLeague==="live"?"No live matches right now":activeLeague==="favorites"?"No favourites yet":"No matches found"}
                  </div>
                </div>
              )}
              {!loading && rightMatches.map(function(m){ return <MatchCard key={m.id} m={m} />; })}
            </div>
          </div>
        )}

        {page==="mybets" && (
          bets.length===0
            ? <div style={{ textAlign:"center", padding:"50px 16px", color:"rgba(255,255,255,0.35)" }}>No bets placed yet</div>
            : [...bets].reverse().map(function(b) {
              var lc2=lcol(b.leagueId);
              var sc=b.status==="won"?"#4ade80":b.status==="lost"?"#f87171":b.status==="refunded"?"#60a5fa":"#fbbf24";
              var sl2=b.status==="won"?"Won":b.status==="lost"?"Lost":b.status==="refunded"?"Refunded":"Pending";
              return <div key={b.id||b._id} style={{ background:"rgba(255,255,255,0.04)", borderLeft:"3px solid "+lc2, border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:"13px 15px", marginBottom:9 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:10, color:lc2, fontWeight:700, marginBottom:3 }}>{b.league}</div>
                    <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginBottom:3 }}>{b.match_label}</div>
                    <div style={{ fontWeight:800, fontSize:14 }}>{b.option_label}</div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:3 }}>{b.market}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>Staked</div>
                    <div style={{ fontWeight:700, color:"#f87171" }}>{fmt(b.amount)}</div>
                    <div style={{ fontSize:11, color:"#4ade80", marginTop:3 }}>Win: {fmt(b.potential)}</div>
                  </div>
                </div>
                <div style={{ marginTop:9, display:"flex", gap:5 }}>
                  <span style={{ fontSize:10, padding:"3px 10px", background:lc2+"18", color:lc2, borderRadius:6, fontWeight:700 }}>{b.odds}x</span>
                  <span style={{ fontSize:10, padding:"3px 10px", background:sc+"18", color:sc, borderRadius:6, fontWeight:700 }}>{sl2}</span>
                </div>
              </div>;
            })
        )}

        {page==="board" && (
          <div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginBottom:12, letterSpacing:1 }}>GLOBAL RANKINGS</div>
            {leaderboard.map(function(p,i) {
              var isMe=p.username===user.username;
              return <div key={p.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 15px", marginBottom:7, background:isMe?"rgba(232,255,71,0.06)":"rgba(255,255,255,0.04)", border:isMe?"1px solid rgba(232,255,71,0.18)":"1px solid rgba(255,255,255,0.07)", borderRadius:13 }}>
                <div style={{ fontSize:14, fontWeight:900, width:28, textAlign:"center", color:i<3?"#e8ff47":"rgba(255,255,255,0.3)" }}>{"#"+(i+1)}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:14, color:isMe?"#e8ff47":"#fff" }}>{p.username}{isMe&&<span style={{ fontSize:10, opacity:0.4 }}> (you)</span>}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginTop:2 }}>{p.wins||0}/{p.total_bets||0} wins</div>
                </div>
                <div style={{ fontWeight:900, fontSize:17, color:isMe?"#e8ff47":"#fff" }}>{fmt(p.balance)}</div>
              </div>;
            })}
          </div>
        )}

        {page==="profile" && (
          <div>
            <div style={{ background:"linear-gradient(135deg,rgba(232,255,71,0.07),rgba(232,255,71,0.02))", border:"1px solid rgba(232,255,71,0.12)", borderRadius:16, padding:18, marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
                <div style={{ width:50, height:50, borderRadius:"50%", background:"linear-gradient(135deg,#e8ff47,#a3e635)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, fontWeight:900, color:"#060d1a" }}>{user.username[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight:900, fontSize:18 }}>{user.username}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginTop:2 }}>Joined {new Date(user.joined).toLocaleDateString("en-GB",{month:"short",year:"numeric"})}</div>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9 }}>
                {[
                  { l:"Balance",    v:fmt(user.balance), c:"#e8ff47" },
                  { l:"Win Rate",   v:winRate+"%",        c:winRate>=50?"#4ade80":"#f87171" },
                  { l:"Total Bets", v:bets.length,        c:"#60a5fa" },
                  { l:"Wagered",    v:fmt(totalWagered),  c:"#f87171" },
                  { l:"Won",        v:wonBets.length,     c:"#4ade80" },
                  { l:"Pending",    v:pendingBets.length, c:"#fbbf24" },
                ].map(function(s,i){
                  return <div key={i} style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"11px 13px" }}>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", marginBottom:3 }}>{s.l}</div>
                    <div style={{ fontSize:19, fontWeight:900, color:s.c }}>{s.v}</div>
                  </div>;
                })}
              </div>
            </div>
            {favTeams.size>0 && (
              <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:15, marginBottom:14 }}>
                <div style={{ fontWeight:800, fontSize:13, marginBottom:10 }}>Favourite Teams</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {Array.from(favTeams).map(function(t) {
                    return <div key={t} style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 10px", background:"rgba(232,255,71,0.08)", border:"1px solid rgba(232,255,71,0.2)", borderRadius:20 }}>
                      <span style={{ fontSize:12, color:"#e8ff47", fontWeight:700 }}>{t}</span>
                      <button onClick={function(){ toggleFavTeam(t); }} style={{ background:"none", border:"none", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:12, padding:0 }}>x</button>
                    </div>;
                  })}
                </div>
              </div>
            )}
            <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:15, marginBottom:14 }}>
              <div style={{ fontWeight:800, fontSize:13, marginBottom:6 }}>P / L Summary</div>
              {[{l:"Wagered",v:fmt(totalWagered),c:"#fff"},{l:"Won",v:fmt(totalWon),c:"#4ade80"},{l:"Net P/L",v:fmt(totalWon-totalWagered),c:totalWon>=totalWagered?"#4ade80":"#f87171"}].map(function(s,i){
                return <div key={i} style={{ fontSize:13, color:"rgba(255,255,255,0.45)", marginBottom:5 }}>{s.l}: <span style={{ color:s.c, fontWeight:700 }}>{s.v}</span></div>;
              })}
            </div>
            <button onClick={logout} style={{ width:"100%", padding:13, background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.2)", color:"#f87171", borderRadius:12, fontWeight:800, cursor:"pointer", fontSize:14 }}>Log Out</button>
          </div>
        )}
      </div>

      {selectedMatch && <MatchModal match={selectedMatch} onClose={function(){ setSelectedMatch(null); }} onAddToBetSlip={addToBetSlip} slip={betSlip} balance={user.balance} favMatches={favMatches} onToggleFavMatch={toggleFavMatch} />}

      <BetSlip slip={betSlip} onRemove={removeFromSlip} onClear={function(){ setBetSlip([]); }} onPlaceAll={placeAllBets} balance={user.balance} />

      {toast && <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"#0e1628", border:"1px solid "+toast.color+"44", color:toast.color, padding:"11px 20px", borderRadius:12, fontWeight:700, fontSize:13, zIndex:400, whiteSpace:"nowrap", boxShadow:"0 8px 32px rgba(0,0,0,0.7)", animation:"toastIn 0.25s ease" }}>{toast.msg}</div>}
    </div>
  );
}
