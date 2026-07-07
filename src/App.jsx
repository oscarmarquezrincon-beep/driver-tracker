import { useState, useEffect, useRef } from "react";
import { Camera, TrendingUp, Trash2, Plus, X, Loader2, Gauge, Settings, ThumbsUp, ThumbsDown } from "lucide-react";

const COLORS = { bg: "#0E1116", panel: "#171B22", panelAlt: "#1E232C", line: "#2A313D", text: "#EDEFF2", textDim: "#8B93A1", accent: "#F4B400", good: "#3DDC97", bad: "#FF5D5D" };

function uid() { return Math.random().toString(36).slice(2, 10); }
function currency(n) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n || 0); }

const storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

export default function DriverApp() {
  const [tab, setTab] = useState("registro");
  const [trips, setTrips] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [gasolina, setGasolina] = useState(0);
  const [thresholds, setThresholds] = useState({ minPerHour: 150, maxKm: 15, minTotal: 35 });
  const [showSettings, setShowSettings] = useState(false);
  const priceFileRef = useRef(null);
  const tripFileRef = useRef(null);
  const [priceProcessing, setPriceProcessing] = useState(false);
  const [priceError, setPriceError] = useState(null);
  const [evaluation, setEvaluation] = useState(null);

  useEffect(() => {
    const t = storage.get("trips"); if (t) setTrips(JSON.parse(t));
    const g = storage.get("gasolina"); if (g) setGasolina(parseFloat(g));
    const th = storage.get("thresholds"); if (th) setThresholds(JSON.parse(th));
    setLoaded(true);
  }, []);

  useEffect(() => { if (loaded) storage.set("trips", JSON.stringify(trips)); }, [trips, loaded]);
  useEffect(() => { if (loaded) storage.set("gasolina", String(gasolina)); }, [gasolina, loaded]);
  useEffect(() => { if (loaded) storage.set("thresholds", JSON.stringify(thresholds)); }, [thresholds, loaded]);

  const today = new Date().toDateString();
  const todayTrips = trips.filter(t => new Date(t.timestamp).toDateString() === today);
  const totals = todayTrips.reduce((acc, t) => { acc.bruto += t.amount; acc.comision += t.platform === "didi" ? t.amount * 0.101 : 0; return acc; }, { bruto: 0, comision: 0 });
  const neto = totals.bruto - totals.comision - gasolina;

  async function toBase64(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
  }

  async function callClaude(base64, mediaType, prompt) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 300, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }, { type: "text", text: prompt }] }] }) });
    const data = await res.json();
    return JSON.parse((data.content?.find(c => c.type === "text")?.text || "").replace(/```json|```/g, "").trim());
  }

  async function handleTripFile(e) {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
    setProcessing(true); setError(null);
    try {
      const parsed = await callClaude(await toBase64(file), file.type || "image/png", "Captura de viaje TERMINADO en Didi o inDrive. Extrae el monto total cobrado (MXN) y la plataforma. Responde SOLO JSON: {\"amount\": numero, \"platform\": \"didi\" o \"indrive\"}. Si no puedes, responde {\"amount\": null, \"platform\": null}.");
      if (!parsed.amount) { setError("No pude leer el monto. Agrega manual con el botón +."); return; }
      setTrips(prev => [{ id: uid(), amount: Number(parsed.amount), platform: parsed.platform || "didi", timestamp: Date.now() }, ...prev]);
    } catch { setError("Error leyendo la captura."); }
    finally { setProcessing(false); }
  }

  async function handlePriceFile(e) {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
    setPriceProcessing(true); setPriceError(null); setEvaluation(null);
    try {
      const parsed = await callClaude(await toBase64(file), file.type || "image/png", "Captura de OFERTA de viaje en Didi o inDrive. Extrae: precio principal (MXN), distancia total en km (recogida+viaje), tiempo total en minutos (recogida+viaje sumados). Responde SOLO JSON: {\"price\": numero, \"km\": numero, \"minutes\": numero}. Si algo no es visible pon null.");
      if (!parsed.price) { setPriceError("No pude leer el precio. Intenta otra captura."); return; }
      const perHour = parsed.minutes ? parsed.price / (parsed.minutes / 60) : null;
      const perKm = parsed.km ? parsed.price / parsed.km : null;
      const reasons = []; let conviene = true;
      if (perHour !== null) { if (perHour < thresholds.minPerHour) { conviene = false; reasons.push(`Pago/hora bajo: ${currency(perHour)}/h (mín: ${currency(thresholds.minPerHour)}/h)`); } else { reasons.push(`Buen pago/hora: ${currency(perHour)}/h`); } } else { reasons.push("Tiempo no visible — evaluado por monto y km."); }
      if (parsed.km && parsed.km > thresholds.maxKm) { conviene = false; reasons.push(`Viaje largo: ${parsed.km} km (máx: ${thresholds.maxKm} km)`); }
      if (parsed.price < thresholds.minTotal) { conviene = false; reasons.push(`Monto bajo: ${currency(parsed.price)} (mín: ${currency(thresholds.minTotal)})`); }
      if (parsed.minutes) reasons.push(`${parsed.minutes} min estimados`);
      setEvaluation({ ...parsed, perHour, perKm, conviene, reasons });
    } catch { setPriceError("Error leyendo la captura."); }
    finally { setPriceProcessing(false); }
  }

  const btnStyle = (active) => ({ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 8px", borderRadius: 10, border: `1px solid ${active ? COLORS.accent : COLORS.line}`, background: active ? "rgba(244,180,0,0.1)" : "transparent", color: active ? COLORS.accent : COLORS.textDim, fontSize: 13, fontWeight: 600, cursor: "pointer" });

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text, fontFamily: "'Inter', system-ui, sans-serif", maxWidth: 480, margin: "0 auto" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap'); * { box-sizing: border-box; } .mono { font-family: 'JetBrains Mono', monospace; } button, label { font-family: inherit; cursor: pointer; }`}</style>
      <div style={{ padding: "28px 20px 16px", borderBottom: `1px solid ${COLORS.line}` }}>
        <div style={{ fontSize: 12, letterSpacing: "0.12em", color: COLORS.accent, fontWeight: 700, textTransform: "uppercase" }}>Turno de hoy</div>
        <div style={{ fontSize: 14, color: COLORS.textDim, marginTop: 2 }}>{new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>
      <div style={{ display: "flex", padding: "16px 20px 0", gap: 8 }}>
        <button style={btnStyle(tab === "registro")} onClick={() => setTab("registro")}><TrendingUp size={15} /> Registro</button>
        <button style={btnStyle(tab === "precio")} onClick={() => setTab("precio")}><Gauge size={15} /> Asistente precio</button>
      </div>
      {tab === "registro" ? (
        <>
          <div style={{ padding: "24px 20px", borderBottom: `1px solid ${COLORS.line}` }}>
            <div style={{ fontSize: 13, color: COLORS.textDim, marginBottom: 4 }}>Neto estimado</div>
            <div className="mono" style={{ fontSize: 44, fontWeight: 700, color: neto >= 0 ? COLORS.text : COLORS.bad }}>{currency(neto)}</div>
            <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
              {[["Bruto", currency(totals.bruto), false, false], ["Comisión", currency(totals.comision), true, false], ["Gasolina", currency(gasolina), true, true], ["Viajes", String(todayTrips.length), false, false]].map(([label, value, neg, edit]) => (
                <div key={label} onClick={edit ? () => setShowAdd("gas") : undefined} style={{ cursor: edit ? "pointer" : "default" }}>
                  <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase" }}>{label}</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: neg ? "#FF8A8A" : COLORS.text }}>{neg ? "-" : ""}{value}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: "20px", display: "flex", gap: 10 }}>
            <input ref={tripFileRef} id="trip-file" type="file" accept="image/*" style={{ display: "none" }} onChange={handleTripFile} />
            <label htmlFor="trip-file" style={{ flex: 1, background: processing ? COLORS.panelAlt : COLORS.accent, color: processing ? COLORS.textDim : "#1A1300", border: processing ? `1px solid ${COLORS.line}` : "none", borderRadius: 14, padding: "16px", fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {processing ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Camera size={18} />}
              {processing ? "Leyendo..." : "Capturar viaje terminado"}
            </label>
            <button onClick={() => setShowAdd(true)} style={{ background: COLORS.panel, color: COLORS.text, border: `1px solid ${COLORS.line}`, borderRadius: 14, padding: "16px 18px" }}><Plus size={18} /></button>
          </div>
          {error && <div style={{ margin: "0 20px 16px", padding: 12, background: "#2A1414", border: `1px solid ${COLORS.bad}`, borderRadius: 10, fontSize: 13, color: "#FFB3B3" }}>{error}</div>}
          <div style={{ padding: "0 20px 100px" }}>
            <div style={{ fontSize: 12, color: COLORS.textDim, fontWeight: 600, textTransform: "uppercase", margin: "8px 0 12px" }}>Viajes registrados</div>
            {todayTrips.length === 0 && <div style={{ padding: "40px 0", textAlign: "center", color: COLORS.textDim, fontSize: 14 }}>Aún no hay viajes hoy.</div>}
            {todayTrips.map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: t.platform === "didi" ? "#FF8A00" : "#00C2A8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#0E1116" }}>{t.platform === "didi" ? "DD" : "iD"}</div>
                  <div>
                    <div className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{currency(t.amount)}</div>
                    <div style={{ fontSize: 12, color: COLORS.textDim }}>{new Date(t.timestamp).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                </div>
                <button onClick={() => setTrips(prev => prev.filter(x => x.id !== t.id))} style={{ background: "none", border: "none", color: COLORS.textDim, padding: 6 }}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ padding: "20px 20px 100px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: COLORS.textDim }}>Mín: {currency(thresholds.minPerHour)}/h · máx: {thresholds.maxKm}km · mín: {currency(thresholds.minTotal)}</div>
            <button onClick={() => setShowSettings(true)} style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 8, color: COLORS.textDim }}><Settings size={15} /></button>
          </div>
          <input ref={priceFileRef} id="price-file" type="file" accept="image/*" style={{ display: "none" }} onChange={handlePriceFile} />
          <label htmlFor="price-file" style={{ width: "100%", background: priceProcessing ? COLORS.panelAlt : COLORS.accent, color: priceProcessing ? COLORS.textDim : "#1A1300", border: priceProcessing ? `1px solid ${COLORS.line}` : "none", borderRadius: 14, padding: "16px", fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16 }}>
            {priceProcessing ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Camera size={18} />}
            {priceProcessing ? "Evaluando..." : "Capturar oferta recibida"}
          </label>
          {priceError && <div style={{ padding: 12, background: "#2A1414", border: `1px solid ${COLORS.bad}`, borderRadius: 10, fontSize: 13, color: "#FFB3B3", marginBottom: 16 }}>{priceError}</div>}
          {evaluation && (
            <div style={{ borderRadius: 16, padding: 20, background: evaluation.conviene ? "rgba(61,220,151,0.08)" : "rgba(255,93,93,0.08)", border: `1.5px solid ${evaluation.conviene ? COLORS.good : COLORS.bad}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                {evaluation.conviene ? <ThumbsUp size={22} color={COLORS.good} /> : <ThumbsDown size={22} color={COLORS.bad} />}
                <div style={{ fontSize: 19, fontWeight: 800, color: evaluation.conviene ? COLORS.good : COLORS.bad }}>{evaluation.conviene ? "CONVIENE" : "NO CONVIENE"}</div>
              </div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                {[["Por hora", evaluation.perHour ? currency(evaluation.perHour) : "—", true], ["Precio", currency(evaluation.price), false], ["Km", evaluation.km ? `${evaluation.km}km` : "—", false], ["Tiempo", evaluation.minutes ? `${evaluation.minutes}min` : "—", false]].map(([label, value, big]) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase" }}>{label}</div>
                    <div className="mono" style={{ fontSize: big ? 24 : 18, fontWeight: big ? 800 : 700, color: big ? (evaluation.conviene ? COLORS.good : COLORS.bad) : COLORS.text }}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 12 }}>
                {evaluation.reasons.map((r, i) => <div key={i} style={{ fontSize: 13, color: COLORS.textDim, marginBottom: 6 }}>• {r}</div>)}
              </div>
            </div>
          )}
          {!evaluation && !priceError && <div style={{ padding: "30px 0", textAlign: "center", color: COLORS.textDim, fontSize: 14 }}>Captura una oferta para evaluarla.</div>}
        </div>
      )}
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={() => setShowAdd(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", background: COLORS.panelAlt, borderRadius: "20px 20px 0 0", padding: 24, borderTop: `1px solid ${COLORS.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{showAdd === "gas" ? "Gasolina de hoy" : "Agregar viaje manual"}</div>
              <button onClick={() => setShowAdd(false)} style={{ background: "none", border: "none", color: COLORS.textDim }}><X size={20} /></button>
            </div>
            <AddForm mode={showAdd} onAddTrip={(amount, platform) => { setTrips(prev => [{ id: uid(), amount: Number(amount), platform, timestamp: Date.now() }, ...prev]); setShowAdd(false); }} onSetGas={v => { setGasolina(v); setShowAdd(false); }} />
          </div>
        </div>
      )}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={() => setShowSettings(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", background: COLORS.panelAlt, borderRadius: "20px 20px 0 0", padding: 24, borderTop: `1px solid ${COLORS.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>Reglas de aceptación</div>
              <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", color: COLORS.textDim }}><X size={20} /></button>
            </div>
            <SettingsForm thresholds={thresholds} onSave={t => { setThresholds(t); setShowSettings(false); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function AddForm({ mode, onAddTrip, onSetGas }) {
  const [amount, setAmount] = useState("");
  const [platform, setPlatform] = useState("didi");
  const s = { width: "100%", background: "#0E1116", border: "1px solid #2A313D", borderRadius: 12, padding: "16px", fontSize: 22, color: "#EDEFF2", marginBottom: 16 };
  return (
    <>
      <input autoFocus type="number" inputMode="decimal" placeholder="$0.00" value={amount} onChange={e => setAmount(e.target.value)} style={s} />
      {mode !== "gas" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {["didi", "indrive"].map(p => (
            <button key={p} onClick={() => setPlatform(p)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${platform === p ? "#F4B400" : "#2A313D"}`, background: platform === p ? "rgba(244,180,0,0.12)" : "transparent", color: platform === p ? "#F4B400" : "#8B93A1", fontWeight: 600 }}>
              {p === "indrive" ? "inDrive" : "Didi"}
            </button>
          ))}
        </div>
      )}
      <button onClick={() => { const v = parseFloat(amount); if (!v || v <= 0) return; mode === "gas" ? onSetGas(v) : onAddTrip(v, platform); }} style={{ width: "100%", background: "#F4B400", color: "#1A1300", border: "none", borderRadius: 12, padding: "16px", fontWeight: 700, fontSize: 15 }}>Guardar</button>
    </>
  );
}

function SettingsForm({ thresholds, onSave }) {
  const [minPerHour, setMinPerHour] = useState(String(thresholds.minPerHour));
  const [maxKm, setMaxKm] = useState(String(thresholds.maxKm));
  const [minTotal, setMinTotal] = useState(String(thresholds.minTotal));
  const s = { width: "100%", background: "#0E1116", border: "1px solid #2A313D", borderRadius: 10, padding: "12px 14px", fontSize: 16, color: "#EDEFF2", marginBottom: 14 };
  return (
    <>
      <div style={{ fontSize: 12, color: "#8B93A1", marginBottom: 6 }}>Mínimo $/hora</div>
      <input type="number" inputMode="decimal" value={minPerHour} onChange={e => setMinPerHour(e.target.value)} style={s} />
      <div style={{ fontSize: 12, color: "#8B93A1", marginBottom: 6 }}>Máxima distancia (km)</div>
      <input type="number" inputMode="decimal" value={maxKm} onChange={e => setMaxKm(e.target.value)} style={s} />
      <div style={{ fontSize: 12, color: "#8B93A1", marginBottom: 6 }}>Mínimo monto total</div>
      <input type="number" inputMode="decimal" value={minTotal} onChange={e => setMinTotal(e.target.value)} style={s} />
      <button onClick={() => onSave({ minPerHour: parseFloat(minPerHour) || 0, maxKm: parseFloat(maxKm) || 999, minTotal: parseFloat(minTotal) || 0 })} style={{ width: "100%", background: "#F4B400", color: "#1A1300", border: "none", borderRadius: 12, padding: "16px", fontWeight: 700, fontSize: 15 }}>Guardar reglas</button>
    </>
  );
        }
