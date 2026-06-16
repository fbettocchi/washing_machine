import { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, CartesianGrid
} from "recharts";

const API_URL   = import.meta.env.VITE_API_URL ?? "";
const PALETTE   = ["#7C6FE0", "#1D9E75", "#E07C6F", "#E0C46F", "#6F9EE0", "#C46FE0"];
const TOKEN_KEY = "wt_token";

function isTokenValid(token) {
  if (!token) return false;
  try {
    const data = atob(token.split(".")[0]);
    const parts = data.split(":");
    return Date.now() / 1000 < parseInt(parts[parts.length - 1]);
  } catch { return false; }
}

// ─── Page de login ────────────────────────────────────────────────────────────
function LoginPage({ onLogin, error }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    await onLogin(username, password);
    setLoading(false);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif", background: "#f5f5f7" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 32, width: 320, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", border: "1px solid #00000010" }}>
        <div style={{ fontWeight: 700, fontSize: 18, color: "#222", marginBottom: 4 }}>🧺 Machines à laver</div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Connectez-vous pour accéder au dashboard</div>
        <form onSubmit={handleSubmit}>
          <input
            type="text" placeholder="Identifiant" value={username} autoFocus required
            onChange={e => setUsername(e.target.value)}
            style={{ display: "block", width: "100%", padding: "9px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 10 }}
          />
          <input
            type="password" placeholder="Mot de passe" value={password} required
            onChange={e => setPassword(e.target.value)}
            style={{ display: "block", width: "100%", padding: "9px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", marginBottom: 14 }}
          />
          {error && (
            <div style={{ background: "#FFF0F0", border: "1px solid #FFB3B3", borderRadius: 6, padding: "7px 10px", marginBottom: 12, fontSize: 13, color: "#C00" }}>{error}</div>
          )}
          <button type="submit" disabled={loading} style={{ width: "100%", padding: 10, borderRadius: 6, border: "none", background: "#7C6FE0", color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isoToLocal(iso) { return new Date(iso); }
function pad2(n) { return String(n).padStart(2, "0"); }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function getMachineColor(id, machines) {
  return machines.find(m => m.id === id)?.color ?? "#888";
}

const DAY_NAMES   = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const MONTH_NAMES = ["Janvier","Février","Mars","Avril","Mai","Juin",
                     "Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

// ─── Composant : pastille de cycle ────────────────────────────────────────────
function CycleChip({ cycle, machines, onClick }) {
  const start = isoToLocal(cycle.start_at);
  const color = getMachineColor(cycle.machine_id, machines);
  const label = machines.find(m => m.id === cycle.machine_id)?.label ?? cycle.machine_id;
  return (
    <div
      onClick={() => onClick(cycle)}
      style={{
        background: color + "22", borderLeft: `3px solid ${color}`,
        borderRadius: 4, padding: "2px 5px", marginBottom: 2, cursor: "pointer",
        fontSize: 11, color, fontWeight: 500,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}
    >
      {pad2(start.getHours())}h{pad2(start.getMinutes())} · {label} · {cycle.duration_minutes} min
    </div>
  );
}

// ─── Vue Mois ─────────────────────────────────────────────────────────────────
function MonthView({ year, month, cycles, machines, onDayClick, onCycleClick }) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7;
  const today    = dateKey(new Date());

  const byDate = useMemo(() => {
    const map = {};
    cycles.forEach(c => {
      if (!map[c.date]) map[c.date] = [];
      map[c.date].push(c);
    });
    return map;
  }, [cycles]);

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, marginBottom: 1 }}>
        {["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "#888", padding: "4px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
        {cells.map((date, i) => {
          if (!date) return <div key={`e${i}`} style={{ minHeight: 90, background: "transparent" }} />;
          const dk = dateKey(date);
          const dayCycles = byDate[dk] ?? [];
          const isToday = dk === today;
          return (
            <div
              key={dk}
              onClick={() => onDayClick(date)}
              style={{
                minHeight: 90, background: isToday ? "#7C6FE011" : "#00000008",
                borderRadius: 6, padding: 4, cursor: "pointer",
                border: isToday ? "1.5px solid #7C6FE0" : "1px solid #00000010",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#7C6FE008"}
              onMouseLeave={e => e.currentTarget.style.background = isToday ? "#7C6FE011" : "#00000008"}
            >
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? "#7C6FE0" : "#444", marginBottom: 3 }}>
                {date.getDate()}
              </div>
              {dayCycles.slice(0, 3).map((c, ci) => (
                <CycleChip key={ci} cycle={c} machines={machines} onClick={onCycleClick} />
              ))}
              {dayCycles.length > 3 && (
                <div style={{ fontSize: 10, color: "#888" }}>+{dayCycles.length - 3} autres</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Vue Semaine ──────────────────────────────────────────────────────────────
function WeekView({ weekStart, cycles, machines, onCycleClick }) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push(d);
  }
  const today = dateKey(new Date());
  const byDate = useMemo(() => {
    const map = {};
    cycles.forEach(c => {
      if (!map[c.date]) map[c.date] = [];
      map[c.date].push(c);
    });
    return map;
  }, [cycles]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
      {days.map(d => {
        const dk = dateKey(d);
        const isToday = dk === today;
        const dayCycles = (byDate[dk] ?? []).sort((a, b) => a.start_at.localeCompare(b.start_at));
        return (
          <div key={dk}>
            <div style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: isToday ? "#7C6FE0" : "#666", marginBottom: 6 }}>
              {DAY_NAMES[d.getDay()]}<br />
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, borderRadius: "50%",
                background: isToday ? "#7C6FE0" : "transparent",
                color: isToday ? "#fff" : "#222", fontSize: 13, fontWeight: 700,
              }}>{d.getDate()}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {dayCycles.length === 0
                ? <div style={{ fontSize: 11, color: "#bbb", textAlign: "center", padding: 8 }}>—</div>
                : dayCycles.map((c, ci) => {
                  const color = getMachineColor(c.machine_id, machines);
                  return (
                    <div
                      key={ci}
                      onClick={() => onCycleClick(c)}
                      style={{ background: color + "22", borderLeft: `3px solid ${color}`, borderRadius: 4, padding: "5px 6px", cursor: "pointer", fontSize: 11 }}
                    >
                      <div style={{ fontWeight: 600, color }}>
                        {machines.find(m => m.id === c.machine_id)?.label ?? c.machine_id}
                      </div>
                      <div style={{ color: "#666", marginTop: 1 }}>
                        {pad2(isoToLocal(c.start_at).getHours())}h{pad2(isoToLocal(c.start_at).getMinutes())}
                        {" → "}
                        {pad2(isoToLocal(c.end_at).getHours())}h{pad2(isoToLocal(c.end_at).getMinutes())}
                      </div>
                      <div style={{ color: "#888", marginTop: 1 }}>{c.duration_minutes} min</div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Vue Jour ─────────────────────────────────────────────────────────────────
function DayView({ date, cycles, machines, onCycleClick }) {
  const dk = dateKey(date);
  const dayCycles = cycles.filter(c => c.date === dk).sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12, color: "#444" }}>
        {DAY_NAMES[date.getDay()]} {date.getDate()} {MONTH_NAMES[date.getMonth()]} {date.getFullYear()}
      </div>
      {dayCycles.length === 0
        ? <div style={{ color: "#aaa", textAlign: "center", padding: 40 }}>Aucun cycle ce jour</div>
        : dayCycles.map((c, i) => {
          const start = isoToLocal(c.start_at);
          const end   = isoToLocal(c.end_at);
          const color = getMachineColor(c.machine_id, machines);
          return (
            <div
              key={i}
              onClick={() => onCycleClick(c)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                background: color + "11", border: `1px solid ${color}33`,
                borderRadius: 8, padding: "12px 16px", marginBottom: 8, cursor: "pointer",
              }}
            >
              <div style={{ width: 4, height: 40, background: color, borderRadius: 2, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color, fontSize: 13 }}>
                  {machines.find(m => m.id === c.machine_id)?.label ?? c.machine_id}
                </div>
                <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
                  {pad2(start.getHours())}:{pad2(start.getMinutes())} → {pad2(end.getHours())}:{pad2(end.getMinutes())}
                </div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color, minWidth: 60, textAlign: "right" }}>
                {c.duration_minutes}<span style={{ fontSize: 12, fontWeight: 400, color: "#888" }}> min</span>
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function StatsPanel({ cycles, machines }) {
  const heatmap = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    cycles.forEach(c => {
      const dow = (isoToLocal(c.start_at).getDay() + 6) % 7;
      grid[dow][c.hour_of_day]++;
    });
    return grid;
  }, [cycles]);

  const maxHeat = Math.max(...heatmap.flat(), 1);
  const avgByMachine = machines.map(m => {
    const mc = cycles.filter(c => c.machine_id === m.id);
    const avg = mc.length ? Math.round(mc.reduce((s, c) => s + c.duration_minutes, 0) / mc.length) : 0;
    return { name: m.label, avg, count: mc.length, color: m.color };
  });

  const byDow = Array(7).fill(0);
  cycles.forEach(c => { byDow[(isoToLocal(c.start_at).getDay() + 6) % 7]++; });
  const dowData = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map((d, i) => ({ day: d, count: byDow[i] }));

  const byHour = Array(24).fill(0);
  cycles.forEach(c => { byHour[c.hour_of_day]++; });
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const quietDow = byDow.indexOf(Math.min(...byDow));

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const recent = cycles.filter(c => new Date(c.start_at) > cutoff);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {[
          { label: "Cycles (30j)", value: recent.length },
          { label: "Durée moyenne", value: `${Math.round(recent.reduce((s,c)=>s+c.duration_minutes,0)/(recent.length||1))} min` },
          { label: "Heure de pointe", value: `${peakHour}h–${peakHour+1}h` },
          { label: "Jour le plus calme", value: ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"][quietDow] },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: "#00000006", borderRadius: 8, padding: "12px 14px", border: "1px solid #00000010" }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{kpi.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#333" }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 8 }}>Activité par heure et jour de semaine</div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "36px repeat(24, 1fr)", gap: 2, minWidth: 580 }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ fontSize: 9, color: "#aaa", textAlign: "center" }}>{h}h</div>
            ))}
            {["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map((d, di) => (
              <>
                <div key={`dl${di}`} style={{ fontSize: 10, color: "#888", display: "flex", alignItems: "center" }}>{d}</div>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = heatmap[di][h];
                  const alpha = v === 0 ? 0.04 : 0.15 + (v / maxHeat) * 0.75;
                  return (
                    <div
                      key={`${di}-${h}`}
                      title={`${d} ${h}h : ${v} cycle${v>1?"s":""}`}
                      style={{ height: 18, borderRadius: 2, background: `rgba(124, 111, 224, ${alpha})` }}
                    />
                  );
                })}
              </>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 8 }}>Cycles par jour de semaine</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={dowData} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="#00000008" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #eee" }} formatter={(v) => [`${v} cycles`, ""]} />
              <Bar dataKey="count" radius={[3,3,0,0]}>
                {dowData.map((_, i) => (
                  <Cell key={i} fill={byDow[i] === Math.min(...byDow) ? "#1D9E75" : "#7C6FE0"} opacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 8 }}>Durée moyenne par machine</div>
          {avgByMachine.map(m => (
            <div key={m.name} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: "#555" }}>{m.name}</span>
                <span style={{ fontWeight: 600, color: m.color }}>{m.avg} min · {m.count} cycles</span>
              </div>
              <div style={{ height: 8, background: "#00000008", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, background: m.color, width: `${Math.min((m.avg / 90) * 100, 100)}%`, transition: "width 0.6s ease" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Modal détail cycle ───────────────────────────────────────────────────────
function CycleModal({ cycle, machines, onClose }) {
  if (!cycle) return null;
  const start = isoToLocal(cycle.start_at);
  const end   = isoToLocal(cycle.end_at);
  const color = getMachineColor(cycle.machine_id, machines);
  const label = machines.find(m => m.id === cycle.machine_id)?.label ?? cycle.machine_id;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, minWidth: 300, boxShadow: "0 8px 40px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color }}>Détail du cycle</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#888" }}>×</button>
        </div>
        {[
          ["Machine", label],
          ["Date", `${DAY_NAMES[start.getDay()]} ${start.getDate()} ${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`],
          ["Début", `${pad2(start.getHours())}:${pad2(start.getMinutes())}`],
          ["Fin", `${pad2(end.getHours())}:${pad2(end.getMinutes())}`],
          ["Durée", `${cycle.duration_minutes} minutes`],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: "#888" }}>{k}</span>
            <span style={{ fontWeight: 600, color: "#333" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── App principale ───────────────────────────────────────────────────────────
export default function App() {
  const today = new Date();
  const [view, setView]           = useState("month");
  const [year, setYear]           = useState(today.getFullYear());
  const [month, setMonth]         = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [filterMachine, setFilterMachine] = useState("all");

  const [token, setToken]         = useState(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    return isTokenValid(t) ? t : null;
  });
  const [loginError, setLoginError] = useState(null);
  const [machines, setMachines]   = useState([]);
  const [cycles, setCycles]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [fetchedMonths, setFetchedMonths] = useState(new Set());

  async function handleLogin(username, password) {
    try {
      const r = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (r.ok) {
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setLoginError(null);
      } else {
        setLoginError(data.error || "Erreur de connexion");
      }
    } catch {
      setLoginError("Impossible de contacter le serveur");
    }
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setMachines([]);
    setCycles([]);
    setFetchedMonths(new Set());
  }

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/states`, { headers: authHeaders })
      .then(r => { if (r.status === 401) { handleLogout(); return null; } return r.json(); })
      .then(data => data && setMachines(
        data.map((m, i) => ({ id: m.machine_id, label: m.name || m.machine_id, color: PALETTE[i % PALETTE.length] }))
      ))
      .catch(e => setError(`Erreur chargement machines : ${e.message}`));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const monthKey = `${year}-${pad2(month + 1)}`;
    if (fetchedMonths.has(monthKey)) return;
    setLoading(true);
    fetch(`${API_URL}/cycles?month=${monthKey}`, { headers: authHeaders })
      .then(r => { if (r.status === 401) { handleLogout(); return null; } return r.json(); })
      .then(data => {
        if (!data) return;
        setCycles(prev => {
          const seen = new Set(prev.map(c => `${c.machine_id}|${c.start_at}`));
          return [...prev, ...data.filter(c => !seen.has(`${c.machine_id}|${c.start_at}`))];
        });
        setFetchedMonths(prev => new Set([...prev, monthKey]));
        setLoading(false);
      })
      .catch(e => { setError(`Erreur chargement cycles : ${e.message}`); setLoading(false); });
  }, [year, month, token]);

  const weekStart = useMemo(() => {
    const d = new Date(selectedDate);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [selectedDate]);

  const filteredCycles = useMemo(() =>
    filterMachine === "all" ? cycles : cycles.filter(c => c.machine_id === filterMachine),
  [filterMachine, cycles]);

  function prevPeriod() {
    if (view === "month") {
      if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1);
    } else if (view === "week") {
      const d = new Date(weekStart); d.setDate(d.getDate() - 7); setSelectedDate(d);
    } else if (view === "day") {
      const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d);
    }
  }
  function nextPeriod() {
    if (view === "month") {
      if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1);
    } else if (view === "week") {
      const d = new Date(weekStart); d.setDate(d.getDate() + 7); setSelectedDate(d);
    } else if (view === "day") {
      const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d);
    }
  }

  function periodLabel() {
    if (view === "month") return `${MONTH_NAMES[month]} ${year}`;
    if (view === "week") {
      const end = new Date(weekStart); end.setDate(end.getDate() + 6);
      return `${weekStart.getDate()} ${MONTH_NAMES[weekStart.getMonth()]} – ${end.getDate()} ${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
    }
    if (view === "day") return `${DAY_NAMES[selectedDate.getDay()]} ${selectedDate.getDate()} ${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;
    return "Statistiques";
  }

  if (!token) return <LoginPage onLogin={handleLogin} error={loginError} />;

  const BTN = { padding: "5px 14px", borderRadius: 6, border: "1px solid #00000018", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 };
  const ACTIVE_BTN = { ...BTN, background: "#7C6FE0", color: "#fff", border: "1px solid #7C6FE0" };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: 900, margin: "0 auto", padding: "16px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 18, color: "#222", marginRight: 8 }}>🧺 Machines à laver</div>

        <select value={filterMachine} onChange={e => setFilterMachine(e.target.value)} style={{ ...BTN, marginRight: "auto" }}>
          <option value="all">Toutes les machines</option>
          {machines.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>

        {["month","week","day","stats"].map(v => (
          <button key={v} onClick={() => setView(v)} style={view === v ? ACTIVE_BTN : BTN}>
            {v === "month" ? "Mois" : v === "week" ? "Semaine" : v === "day" ? "Jour" : "Statistiques"}
          </button>
        ))}
        <button onClick={handleLogout} style={{ ...BTN, color: "#999", marginLeft: 4 }}>Déconnexion</button>
      </div>

      {error && (
        <div style={{ background: "#FFF0F0", border: "1px solid #FFB3B3", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 13, color: "#C00" }}>
          {error}
        </div>
      )}

      {view !== "stats" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button onClick={prevPeriod} style={BTN}>‹</button>
          <button onClick={() => { setSelectedDate(today); setYear(today.getFullYear()); setMonth(today.getMonth()); }} style={BTN}>Aujourd'hui</button>
          <button onClick={nextPeriod} style={BTN}>›</button>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#333", marginLeft: 4 }}>{periodLabel()}</span>
          {loading && <span style={{ fontSize: 12, color: "#999" }}>Chargement…</span>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
            {machines.map(m => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: m.color }} />
                {m.label}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: "1px solid #00000010" }}>
        {view === "month" && (
          <MonthView year={year} month={month} cycles={filteredCycles} machines={machines}
            onDayClick={d => { setSelectedDate(d); setView("day"); }}
            onCycleClick={setSelectedCycle} />
        )}
        {view === "week" && (
          <WeekView weekStart={weekStart} cycles={filteredCycles} machines={machines} onCycleClick={setSelectedCycle} />
        )}
        {view === "day" && (
          <DayView date={selectedDate} cycles={filteredCycles} machines={machines} onCycleClick={setSelectedCycle} />
        )}
        {view === "stats" && (
          <StatsPanel cycles={cycles} machines={machines} />
        )}
      </div>

      <CycleModal cycle={selectedCycle} machines={machines} onClose={() => setSelectedCycle(null)} />
    </div>
  );
}
