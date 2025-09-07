import React, { useMemo, useState } from "react";
import devicesRaw from "./devices.json";

/** === KONFIGŪRA (pakeiskite pagal save) === */
const COMPANY_EMAIL = "sales@jusuimone.lt";
const PREMIUM_MIN_BUDGET = 4000;

/** === PAGALBINĖS FUNKCIJOS === */
function estimateRequiredKw(area, insulation) {
  const A = Number(area) || 0;
  const coef = {
    "Labai gera (A+/A)": 0.045,
    "Vidutinė (B/C)": 0.06,
    "Silpna (D ir senesni)": 0.085,
  }[insulation] ?? 0.06;
  return Math.max(5, Math.round(A * coef));
}
function eur(v) {
  if (v == null) return "-";
  try {
    return new Intl.NumberFormat("lt-LT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  } catch { return v + " €"; }
}
const asArray = (x) => (Array.isArray(x) ? x : []);
function normalizeDevices(data) {
  if (Array.isArray(data)) return data;
  const prem = asArray(data.premium).map(d => ({ ...d, tier: d.tier || "premium" }));
  const budg = asArray(data.budget).map(d => ({ ...d, tier: d.tier || "budget" }));
  return [...prem, ...budg];
}

/** === KOMPONENTAS === */
export default function HeatingAssistant() {
  const devices = useMemo(() => normalizeDevices(devicesRaw), []);
  const [inputs, setInputs] = useState({
    buildingType: "Namas",
    area: "",
    insulation: "",
    gasAvailable: "Ne",     // "Taip" | "Ne"
    gasLineNearby: false,
    ownPowerPlant: false,
    solarPanels: false,
    dhwType: "",            // "Integruotas boileris" | "Atskiras boileris" | "Nereikia"
    budget: "",
    email: "",
  });
  const [sortBy, setSortBy] = useState("best"); // best | price_asc | price_desc | power_asc | power_desc
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([
    { sender: "AI", text: "Sveiki! Užduokite bet kokį klausimą apie šildymą." },
  ]);
  const [showBetterOffer, setShowBetterOffer] = useState(false);
  const [ignoreStrictFilters, setIgnoreStrictFilters] = useState(false); // diagnostikai

  const showGasNearby = inputs.gasAvailable === "Ne";
  const budgetNum = useMemo(() => {
    const n = parseInt(String(inputs.budget).replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : undefined;
  }, [inputs.budget]);
  const requiredKw = useMemo(
    () => estimateRequiredKw(inputs.area, inputs.insulation),
    [inputs.area, inputs.insulation]
  );

  /** — Filtravimas — */
  const filteredAll = useMemo(() => {
    let list = [...devices];

    // 1) Kuras / dujos
    list = list.filter((d) => {
      if (d.fuel === "gas") {
        if (inputs.gasAvailable === "Taip") return true;
        if (inputs.gasAvailable === "Ne" && inputs.gasLineNearby) return true;
        return false;
      }
      return true;
    });

    // 2) Saulės suderinamumas (tik jei pažymėta)
    if (inputs.solarPanels) {
      list = list.filter((d) => d.solar_compatible !== false);
    }

    // 3) DHW: nebeatmetam – tik dedam pastabą
    if (inputs.dhwType) {
      list = list.map((d) => {
        let dhwNote = "";
        if (inputs.dhwType === "Integruotas boileris" && d.dhw !== "integruotas") {
          dhwNote = "Reikės atskiro boilerio";
        }
        if (inputs.dhwType === "Nereikia" && d.dhw !== "none") {
          dhwNote = "Boilerį galima nenaudoti / atjungti";
        }
        return { ...d, _dhwNote: dhwNote };
      });
    }

    // 4) Galia (lankstesnė; dujiniams leidžiam didesnį oversize)
    const need = requiredKw || 0;
    if (!ignoreStrictFilters) {
      list = list.filter((d) => {
        if (!need) return true;
        const single = d.power_kw ?? null;
        let pmin = d.power_kw_min ?? null;
        let pmax = d.power_kw_max ?? null;

        if (single != null) { // turim vieną skaičių
          pmax = single;
          pmin = single * 0.2; // moduliacijos prielaida
        }

        if (d.fuel === "gas") {
          const assumedMin = Math.max(3, Math.round((pmin ?? 0) || (pmax ? pmax * 0.2 : 3)));
          return assumedMin <= need * 1.2; // svarbi apatinė riba
        }

        const low = pmin ?? (pmax ?? 0);
        const high = pmax ?? (pmin ?? 0);
        if (!low && !high) return true;

        if (low === high) {
          return low >= need * 0.7 && low <= need * 1.7;
        }
        return need >= (low * 0.6) && need <= (high * 1.4);
      });
    }

    // 5) Biudžetas (nebent ignoruojam)
    if (!ignoreStrictFilters && budgetNum) {
      list = list.filter((d) => (d.price_eur ?? Infinity) <= budgetNum);
    }

    // 6) Score/rūšiavimas
    list = list.map((d) => {
      const ref = d.power_kw ?? d.power_kw_min ?? need;
      const score = Math.abs((ref || need) - need) + (d.price_eur || 999999) / 100000;
      return { ...d, _score: score };
    });
    switch (sortBy) {
      case "price_asc":  list.sort((a, b) => (a.price_eur || 9e9) - (b.price_eur || 9e9)); break;
      case "price_desc": list.sort((a, b) => (b.price_eur || -1) - (a.price_eur || -1)); break;
      case "power_asc":  list.sort((a, b) =>
        (a.power_kw ?? a.power_kw_min ?? 0) - (b.power_kw ?? b.power_kw_min ?? 0)); break;
      case "power_desc": list.sort((a, b) =>
        (b.power_kw ?? b.power_kw_min ?? 0) - (a.power_kw ?? a.power_kw_min ?? 0)); break;
      default:            list.sort((a, b) => a._score - b._score);
    }
    return list;
  }, [
    devices, inputs.gasAvailable, inputs.gasLineNearby, inputs.solarPanels,
    inputs.dhwType, requiredKw, budgetNum, sortBy, ignoreStrictFilters
  ]);

  // Tiers
  const premiumList = useMemo(() => filteredAll.filter(d => (d.tier || "").toLowerCase() === "premium"), [filteredAll]);
  const budgetList  = useMemo(() => filteredAll.filter(d => (d.tier || "").toLowerCase() === "budget"),  [filteredAll]);
  const hasTiers    = premiumList.length + budgetList.length > 0 && premiumList.length !== filteredAll.length;
  const commonList  = useMemo(() => (!hasTiers ? filteredAll : []), [hasTiers, filteredAll]);

  /** — ĮVESTYS — */
  function handleInputChange(e) {
    const { name, value, type, checked } = e.target;
    setInputs((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  /** — Laiškai — */
  const emailSubject = (prefix) => `${prefix} – Šildymo įrenginių pasiūlymo užklausa`;
  const devicesToLines = (list) => {
    if (!list.length) return ["(šiuo metu filtras negrąžino variantų)"];
    return list.slice(0, 10).map((d, i) => {
      const power = d.power_kw != null ? `${d.power_kw} kW` : `${d.power_kw_min ?? "?"}–${d.power_kw_max ?? "?"} kW`;
      const extras = [];
      if (d.scop) extras.push(`SCOP ${d.scop}`);
      if (d.cop) extras.push(`COP ${d.cop}`);
      if (d.min_temp != null) extras.push(`iki ${d.min_temp} °C`);
      if (d.refrigerant) extras.push(d.refrigerant);
      const extraTxt = extras.length ? ` | ${extras.join(" · ")}` : "";
      return `${i + 1}) ${d.brand} ${d.model} (${d.type}) – ${power}, kaina: ${eur(d.price_eur)}${extraTxt}${d._dhwNote ? " | " + d._dhwNote : ""}`;
    });
  };
  const objectSummaryLines = () => [
    "Objekto duomenys:",
    `- Pastato tipas: ${inputs.buildingType}`,
    `- Plotas: ${inputs.area || "?"} m²`,
    `- Izoliacija: ${inputs.insulation || "?"}`,
    `- Dujos: ${inputs.gasAvailable}${inputs.gasAvailable === "Ne" ? `, trasa šalia: ${inputs.gasLineNearby ? "Taip" : "Ne"}` : ""}`,
    `- PV/elektrinė: ${inputs.solarPanels ? "Yra PV" : "Nėra"}${inputs.ownPowerPlant ? ", yra nuosava elektrinė" : ""}`,
    `- Karšto vandens ruošimas: ${inputs.dhwType || "Nenurodyta"}`,
    `- Biudžetas: ${inputs.budget || "Nenurodytas"}`,
    inputs.email ? `- Kliento el. paštas: ${inputs.email}` : "",
  ].filter(Boolean);
  const openMailTo = (to, subject, bodyLines) => {
    const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
    window.location.href = href;
  };

  function handleGetQuote() {
    const top = filteredAll.slice(0, 3);
    const emails = new Set();
    top.forEach((d) => (d.vendors || []).forEach((v) => v.email && emails.add(v.email)));
    const to = Array.from(emails).join(",") || COMPANY_EMAIL;
    const body = ["Sveiki,", "", "Prašau pateikti pasiūlymą šiems įrenginiams:", ...devicesToLines(top), "", ...objectSummaryLines(), "", "Ačiū!"];
    openMailTo(to, emailSubject("Užklausa"), body);
  }
  function handleBetterOffer(withInstallation) {
    if (!inputs.email) {
      alert("Įrašykite savo el. paštą, kad galėtume su jumis susisiekti.");
      return;
    }
    const usePremiumFirst = hasTiers && (budgetNum ? budgetNum >= PREMIUM_MIN_BUDGET : true);
    const blocks = [];
    if (hasTiers) {
      if (usePremiumFirst) {
        if (premiumList.length) blocks.push("REKOMENDUOJAMI (Premium):", ...devicesToLines(premiumList));
        if (budgetList.length)  blocks.push("", "GALIMI PIGESNI (Budget):", ...devicesToLines(budgetList));
      } else {
        if (budgetList.length)  blocks.push("GALIMI PIGESNI (Budget):", ...devicesToLines(budgetList));
        if (premiumList.length) blocks.push("", "REKOMENDUOJAMI (Premium):", ...devicesToLines(premiumList));
      }
    } else {
      blocks.push(...devicesToLines(filteredAll));
    }
    const subject = emailSubject(withInstallation ? "Prašau geresnio pasiūlymo SU montavimu" : "Prašau geresnio pasiūlymo BE montavimo");
    const body = [
      "Sveiki,",
      "",
      withInstallation
        ? "Noriu geresnio pasiūlymo SU montavimu. Žemiau – automatiškai atrinkti įrenginiai:"
        : "Noriu geresnio pasiūlymo BE montavimo. Žemiau – automatiškai atrinkti įrenginiai:",
      "",
      ...blocks,
      "",
      ...objectSummaryLines(),
      "",
      "Ačiū!",
    ];
    openMailTo(COMPANY_EMAIL, subject, body);
    setShowBetterOffer(false);
  }

  /** — Chat dėžutė — */
  function handleChatSend() {
    const q = chatInput.trim();
    if (!q) return;
    setChatMessages((p) => [...p, { sender: "Jūs", text: q }]);
    const low = q.toLowerCase();
    let a = "Ačiū! Užpildykite laukus viršuje – lentelė atsinaujins. Tiksliems skaičiavimams reikalingas detalus šilumos nuostolių skaičiavimas.";
    if (low.includes("kiek kw") || low.includes("koks galingumas")) {
      a = `Apytikslis poreikis: ~${requiredKw} kW pagal jūsų plotą ir izoliaciją.`;
    } else if (low.includes("dujos")) {
      a = inputs.gasAvailable === "Taip"
        ? "Turint dujų įvadą, tinka kondensaciniai dujiniai katilai (Vitodens, Bosch, Buderus)."
        : showGasNearby
        ? "Dujų įvado nėra. Jei trasa šalia – jungtis galima; kitu atveju – granulės ar šilumos siurblys."
        : "Dujų įvado nėra. Svarstykite granules, kietą kurą arba šilumos siurblį.";
    } else if (low.includes("saul")) {
      a = inputs.solarPanels
        ? "Turint saulės modulius, šilumos siurblys ar elektrinis katilas tampa patrauklesni."
        : "Be saulės modulių šilumos siurblys vis tiek efektyvus, bet elektros kaina reikšminga.";
    }
    setChatMessages((p) => [...p, { sender: "AI", text: a }]);
    setChatInput("");
  }

  /** — UI — */
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white/70 backdrop-blur sticky top-0 z-10 border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Šildymo įrenginių parinkimo asistentas</h1>
          <div className="text-sm text-slate-500">Minimalus • Profesionalus • Aiškus</div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* FORMA */}
        <section className="bg-white rounded-2xl shadow-sm border p-4 md:p-6 mb-6">
          <h2 className="text-lg font-medium mb-4">Objekto parametrai</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Pastato tipas">
              <select name="buildingType" className="border rounded-lg w-full p-2" value={inputs.buildingType} onChange={handleInputChange}>
                <option>Namas</option><option>Butas</option><option>Kotedžas</option>
              </select>
            </Field>
            <Field label="Bendras plotas (m²)">
              <input name="area" className="border rounded-lg w-full p-2" type="number" placeholder="pvz., 150" value={inputs.area} onChange={handleInputChange}/>
            </Field>
            <Field label="Izoliacija">
              <select name="insulation" className="border rounded-lg w-full p-2" value={inputs.insulation} onChange={handleInputChange}>
                <option value="">— Pasirinkite —</option>
                <option>Labai gera (A+/A)</option>
                <option>Vidutinė (B/C)</option>
                <option>Silpna (D ir senesni)</option>
              </select>
              {inputs.area && inputs.insulation && (
                <p className="text-xs text-slate-500 mt-1">Apytikslis poreikis: <strong>{requiredKw} kW</strong></p>
              )}
            </Field>
            <Field label="Ar yra dujų įvadas?">
              <div className="flex gap-6">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="gasAvailable" value="Taip" checked={inputs.gasAvailable === "Taip"} onChange={handleInputChange}/> Taip
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="gasAvailable" value="Ne" checked={inputs.gasAvailable === "Ne"} onChange={handleInputChange}/> Ne
                </label>
              </div>
              {showGasNearby && (
                <label className="inline-flex items-center gap-2 mt-2">
                  <input type="checkbox" name="gasLineNearby" checked={inputs.gasLineNearby} onChange={handleInputChange}/> Ar yra dujų trasa šalia?
                </label>
              )}
            </Field>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="ownPowerPlant" checked={inputs.ownPowerPlant} onChange={handleInputChange}/> Yra nuosava elektrinė
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="solarPanels" checked={inputs.solarPanels} onChange={handleInputChange}/> Yra saulės baterijos
            </label>
            <Field label="Karšto vandens ruošimas">
              <select name="dhwType" className="border rounded-lg w-full p-2" value={inputs.dhwType} onChange={handleInputChange}>
                <option value="">— Pasirinkite —</option>
                <option>Integruotas boileris</option>
                <option>Atskiras boileris</option>
                <option>Nereikia</option>
              </select>
            </Field>
            <Field label="Biudžetas (€)">
              <input name="budget" className="border rounded-lg w-full p-2" type="number" placeholder="pvz., 5000" value={inputs.budget} onChange={handleInputChange}/>
            </Field>
            <Field label="Jūsų el. paštas (kontaktui)">
              <input name="email" className="border rounded-lg w-full p-2" type="email" placeholder="vardas@pastas.lt" value={inputs.email} onChange={handleInputChange}/>
            </Field>
          </div>
        </section>

        {/* VALDIKLIAI + LENTELĖS */}
        <section className="bg-white rounded-2xl shadow-sm border p-4 md:p-6 mb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-lg font-medium">Siūlomi įrenginiai</h2>
            <div className="flex items-center gap-3">
              <label className="text-sm text-slate-600">Rūšiuoti pagal:</label>
              <select className="border rounded-lg p-2" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="best">Geriausias atitikimas</option>
                <option value="price_asc">Kaina ↑</option>
                <option value="price_desc">Kaina ↓</option>
                <option value="power_asc">Galia ↑</option>
                <option value="power_desc">Galia ↓</option>
              </select>
              <label className="text-sm text-slate-600 inline-flex items-center gap-2">
                <input type="checkbox" checked={ignoreStrictFilters} onChange={(e) => setIgnoreStrictFilters(e.target.checked)}/>
                Rodyti visus (nepaisant galios/biudžeto)
              </label>
            </div>
          </div>

          {/* Bendras arba Premium/Budget išdėstymas */}
          {!hasTiers && <DeviceTable list={commonList} />}
          {hasTiers && (
            <>
              {(budgetNum ? budgetNum >= PREMIUM_MIN_BUDGET : true) && (
                <>
                  <h3 className="text-base font-medium mt-4 mb-2">Mūsų rekomenduojami (Premium)</h3>
                  <DeviceTable list={premiumList} />
                  {budgetList.length > 0 && (
                    <>
                      <h3 className="text-base font-medium mt-6 mb-2">Galimi pigesni (Budget)</h3>
                      <DeviceTable list={budgetList} />
                    </>
                  )}
                </>
              )}
              {budgetNum && budgetNum < PREMIUM_MIN_BUDGET && (
                <>
                  <h3 className="text-base font-medium mt-4 mb-2">Galimi pigesni (Budget)</h3>
                  <DeviceTable list={budgetList} />
                  {premiumList.length > 0 && (
                    <>
                      <h3 className="text-base font-medium mt-6 mb-2">Mūsų rekomenduojami (Premium)</h3>
                      <DeviceTable list={premiumList} />
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* Veiksmai */}
          <div className="mt-4 flex flex-col md:flex-row gap-3">
            <button onClick={handleGetQuote} className="inline-flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 font-medium shadow">
              Gauti pasiūlymą
            </button>
            <button onClick={() => setShowBetterOffer(true)} className="inline-flex items-center justify-center rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 px-4 py-2 font-medium border border-amber-200">
              ⚠️ Neskubėkite pirkti! Galbūt mes galime pateikti jums geresnį pasiūlymą.
            </button>
          </div>

          <p className="text-sm text-slate-500 mt-3">
            Premium gamintojus rekomenduojame dėl efektyvumo (SCOP), darbo prie šalčio (min. darbinė temperatūra), patikimumo ir serviso.
            Pigesni variantai galimi, jei biudžetas ribotas.
          </p>
        </section>

        {/* AI dėžutė */}
        <section className="bg-white rounded-2xl shadow-sm border p-4 md:p-6">
          <h2 className="text-lg font-medium mb-3">AI pokalbių dėžutė</h2>
          <div className="h-44 overflow-y-auto border rounded-lg p-3 bg-slate-50">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className="mb-1">
                <strong className={msg.sender === "AI" ? "text-slate-600" : "text-slate-900"}>{msg.sender}:</strong> {msg.text}
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="flex-1 border rounded-lg p-2" placeholder="Jūsų klausimas apie šildymą…" value={chatInput}
                   onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleChatSend()} />
            <button onClick={handleChatSend} className="rounded-xl bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 font-medium">Siųsti</button>
          </div>
        </section>
      </main>

      <footer className="py-8 text-center text-xs text-slate-400">© {new Date().getFullYear()} Jūsų įmonė • Šildymo sprendimai</footer>

      {/* MODALAS: “Neskubėkite pirkti…” */}
      {showBetterOffer && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border p-6">
            <h3 className="text-lg font-semibold mb-2">Geresnio pasiūlymo galimybė</h3>
            <p className="text-slate-600">
              Mes esame profesionalai ir perkame didesnius kiekius, todėl galime pasiūlyti geresnes nuolaidas.
              Kai kuriuos įrenginius perkame tiesiai iš gamintojo. Taip pat galime pasiūlyti montavimo paslaugą.
            </p>
            <div className="mt-4 grid gap-2">
              <button onClick={() => handleBetterOffer(true)} className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 font-medium">
                Taip, noriu geresnio pasiūlymo su montavimu
              </button>
              <button onClick={() => handleBetterOffer(false)} className="rounded-xl bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 font-medium">
                Taip, noriu geresnio pasiūlymo be montavimo
              </button>
              <button onClick={() => setShowBetterOffer(false)} className="rounded-xl bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 font-medium border">
                Atšaukti
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-3">* Laiške bus pridėtas jūsų el. paštas ir šiuo metu automatiškai atrinkti įrenginiai.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** — Maži UI helperiai — */
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
function DeviceTable({ list }) {
  if (!list || list.length === 0) {
    return <div className="border rounded-xl p-4 text-center text-slate-400">Nėra tinkamų įrenginių pagal pasirinktus kriterijus.</div>;
  }
  return (
    <div className="overflow-x-auto border rounded-xl">
      <table className="w-full text-sm">
        <thead className="bg-slate-100">
          <tr>
            <Th>Tipas</Th><Th>Modelis</Th><Th>Kuras</Th><Th center>Galia (kW)</Th><Th center>Kaina</Th><Th>Argumentai</Th><Th>Pardavėjai</Th>
          </tr>
        </thead>
        <tbody>
          {list.map((d) => (
            <tr key={d.id} className="border-t">
              <Td>{d.type}</Td>
              <Td>
                {d.brand} {d.model}
                {d.tier && (
                  <span className="ml-2 inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border">
                    {d.tier}
                  </span>
                )}
              </Td>
              <Td>{d.fuel}</Td>
              <Td center>{d.power_kw != null ? d.power_kw : `${d.power_kw_min ?? "?"}–${d.power_kw_max ?? "?"}`}</Td>
              <Td center>{eur(d.price_eur)}</Td>
              <Td>
                <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                  {d.scop && <li>SCOP {d.scop}</li>}
                  {d.cop && <li>COP {d.cop}</li>}
                  {d.min_temp != null && <li>Darbas iki {d.min_temp} °C</li>}
                  {d.refrigerant && <li>Šaltnešis {d.refrigerant}</li>}
                  {d._dhwNote && <li>{d._dhwNote}</li>}
                  {d.notes && <li>{d.notes}</li>}
                </ul>
              </Td>
              <Td>
                {(d.vendors || []).map((v, idx) => (
                  <a key={idx} href={v.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline mr-2" title={v.email || ""}>
                    {v.name}
                  </a>
                ))}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Th({ children, center }) {
  return <th className={`p-2 border-b text-left ${center ? "text-center" : ""}`}>{children}</th>;
}
function Td({ children, center }) {
  return <td className={`p-2 align-top ${center ? "text-center" : ""}`}>{children}</td>;
}
