import React, { useMemo, useState, useRef } from "react";
import devicesRaw from "./devices.json";

/**
 * NUSTATYMAI – pakeiskite pagal savo įmonę
 */
const COMPANY_EMAIL = "sales@jusuimone.lt"; // <-- Pakeiskite į Jūsų pašto adresą
const PREMIUM_MIN_BUDGET = 4000;            // nuo šios ribos rodysime Premium pirmiau ir atskirai

/**
 * Pagalbinės funkcijos
 */
function estimateRequiredKw(area, insulation) {
  const A = Number(area) || 0;
  const coefMap = {
    "Labai gera (A+/A)": 0.045,
    "Vidutinė (B/C)": 0.06,
    "Silpna (D ir senesni)": 0.085,
  };
  const coef = coefMap[insulation] ?? 0.06;
  return Math.max(5, Math.round(A * coef));
}
function eur(v) {
  if (v == null) return "-";
  try {
    return new Intl.NumberFormat("lt-LT", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return v + " €";
  }
}
function asArray(x) { return Array.isArray(x) ? x : []; }

/**
 * Jei devices.json turi atskiras kategorijas – sutvarkom
 * Leidžiami formatai:
 * 1) Array<device>
 * 2) { premium: Array<device>, budget: Array<device> }
 */
function normalizeDevices(data) {
  if (Array.isArray(data)) return data;
  const prem = asArray(data.premium).map(d => ({ ...d, tier: d.tier || "premium" }));
  const budg = asArray(data.budget).map(d => ({ ...d, tier: d.tier || "budget" }));
  return [...prem, ...budg];
}

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

  const [chatMessages, setChatMessages] = useState([
    { sender: "AI", text: "Sveiki! Užduokite bet kokį klausimą apie šildymą." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [sortBy, setSortBy] = useState("best"); // best | price_asc | price_desc | power_asc | power_desc

  // Modalas „Neskubėkite pirkti…“
  const [showBetterOffer, setShowBetterOffer] = useState(false);

  const showGasNearby = inputs.gasAvailable === "Ne";
  const budgetNum = useMemo(() => {
    const n = parseInt(String(inputs.budget).replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : undefined;
  }, [inputs.budget]);

  const requiredKw = useMemo(
    () => estimateRequiredKw(inputs.area, inputs.insulation),
    [inputs.area, inputs.insulation]
  );

  /**
   * Pagrindinis filtravimas
   */
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

    // 2) Saulės suderinamumas
    if (inputs.solarPanels) {
      list = list.filter((d) => d.solar_compatible !== false);
    }

    // 3) DHW tipas (jei nurodytas)
    if (inputs.dhwType) {
      list = list.filter((d) => {
        if (!d.dhw) return inputs.dhwType === "Nereikia";
        if (inputs.dhwType === "Nereikia") return d.dhw === "none";
        if (inputs.dhwType === "Integruotas boileris") return d.dhw === "integruotas";
        if (inputs.dhwType === "Atskiras boileris") return d.dhw === "atskiras";
        return true;
      });
    }

    // 4) Galia
    const need = requiredKw || 0;
    list = list.filter((d) => {
      const pk = d.power_kw;
      const pmin = d.power_kw_min ?? pk ?? 0;
      const pmax = d.power_kw_max ?? pk ?? 0;
      if (!need) return true;
      if (pmin === pmax) return pmin >= need * 0.8 && pmin <= need * 1.5;
      return need >= pmin * 0.7 && need <= pmax * 1.3;
    });

    // 5) Biudžetas
    if (budgetNum) list = list.filter((d) => (d.price_eur ?? Infinity) <= budgetNum);

    // 6) Score „geriausias atitikimas“
    const withScore = list.map((d) => {
      const ref = d.power_kw ?? d.power_kw_min ?? need;
      const score = Math.abs((ref || need) - need) + (d.price_eur || 999999) / 100000;
      return { ...d, _score: score };
    });

    // 7) Rūšiavimas
    switch (sortBy) {
      case "price_asc":
        withScore.sort((a, b) => (a.price_eur || 9e9) - (b.price_eur || 9e9));
        break;
      case "price_desc":
        withScore.sort((a, b) => (b.price_eur || -1) - (a.price_eur || -1));
        break;
      case "power_asc": {
        const p = (d) => d.power_kw ?? d.power_kw_min ?? d.power_kw_max ?? 0;
        withScore.sort((a, b) => p(a) - p(b));
        break;
      }
      case "power_desc": {
        const p = (d) => d.power_kw ?? d.power_kw_min ?? d.power_kw_max ?? 0;
        withScore.sort((a, b) => p(b) - p(a));
        break;
      }
      default:
        withScore.sort((a, b) => a._score - b._score);
    }

    return withScore;
  }, [
    devices,
    inputs.gasAvailable,
    inputs.gasLineNearby,
    inputs.solarPanels,
    inputs.dhwType,
    requiredKw,
    budgetNum,
    sortBy,
  ]);

  // Atskiriam Premium / Budget (jei turim tier)
  const premiumList = useMemo(
    () => filteredAll.filter((d) => (d.tier || "").toLowerCase() === "premium"),
    [filteredAll]
  );
  const budgetList = useMemo(
    () => filteredAll.filter((d) => (d.tier || "").toLowerCase() === "budget"),
    [filteredAll]
  );
  const hasTiers = premiumList.length + budgetList.length > 0 && premiumList.length !== filteredAll.length;

  // Jei nėra tier – rodysime vieną bendrą lentelę
  const commonList = useMemo(() => (!hasTiers ? filteredAll : []), [hasTiers, filteredAll]);

  function handleInputChange(e) {
    const { name, value, type, checked } = e.target;
    setInputs((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  /**
   * El. laiškai
   */
  function emailSubject(prefix) {
    return `${prefix} – Šildymo įrenginių pasiūlymo užklausa`;
  }

  function devicesToLines(list) {
    if (!list.length) return ["(šiuo metu filtras negrąžino variantų)"];
    return list.slice(0, 10).map((d, i) => {
      const power =
        d.power_kw != null
          ? `${d.power_kw} kW`
          : `${d.power_kw_min ?? "?"}–${d.power_kw_max ?? "?"} kW`;
      const extras = [];
      if (d.scop) extras.push(`SCOP ${d.scop}`);
      if (d.cop) extras.push(`COP ${d.cop}`);
      if (d.min_temp != null) extras.push(`iki ${d.min_temp} °C`);
      if (d.refrigerant) extras.push(d.refrigerant);
      const extraTxt = extras.length ? ` | ${extras.join(" · ")}` : "";
      return `${i + 1}) ${d.brand} ${d.model} (${d.type}) – ${power}, kaina: ${eur(
        d.price_eur
      )}${extraTxt}`;
    });
  }

  function objectSummaryLines() {
    return [
      "Objekto duomenys:",
      `- Pastato tipas: ${inputs.buildingType}`,
      `- Plotas: ${inputs.area || "?"} m²`,
      `- Izoliacija: ${inputs.insulation || "?"}`,
      `- Dujos: ${inputs.gasAvailable}${
        inputs.gasAvailable === "Ne" ? `, trasa šalia: ${inputs.gasLineNearby ? "Taip" : "Ne"}` : ""
      }`,
      `- PV/elektrinė: ${inputs.solarPanels ? "Yra PV" : "Nėra"}${
        inputs.ownPowerPlant ? ", yra nuosava elektrinė" : ""
      }`,
      `- Karšto vandens ruošimas: ${inputs.dhwType || "Nenurodyta"}`,
      `- Biudžetas: ${inputs.budget || "Nenurodytas"}`,
      inputs.email ? `- Kliento el. paštas: ${inputs.email}` : "",
    ].filter(Boolean);
  }

  function openMailTo(to, subject, bodyLines) {
    const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
    window.location.href = href;
  }

  function handleGetQuote() {
    // „Gauti pasiūlymą“ – siunčiame pardavėjams iš TOP-3 (jei yra vendor email)
    const top = filteredAll.slice(0, 3);
    const emails = new Set();
    top.forEach((d) => (d.vendors || []).forEach((v) => v.email && emails.add(v.email)));
    const to = Array.from(emails).join(",") || COMPANY_EMAIL;

    const subject = emailSubject("Užklausa");
    const body = [
      "Sveiki,",
      "",
      "Prašau pateikti pasiūlymą šiems įrenginiams:",
      ...devicesToLines(top),
      "",
      ...objectSummaryLines(),
      "",
      "Ačiū!",
    ];
    openMailTo(to, subject, body);
  }

  function handleBetterOffer(withInstallation) {
    if (!inputs.email) {
      alert("Įrašykite savo el. paštą, kad galėtume su jumis susisiekti.");
      return;
    }
    const subject = emailSubject(
      withInstallation
        ? "Prašau geresnio pasiūlymo SU montavimu"
        : "Prašau geresnio pasiūlymo BE montavimo"
    );

    // Jeigu turime tiers ir didelį biudžetą – pirma Premium + Budget
    const usePremiumFirst = hasTiers && (budgetNum ? budgetNum >= PREMIUM_MIN_BUDGET : true);

    const blocks = [];
    if (hasTiers) {
      if (usePremiumFirst) {
        if (premiumList.length) blocks.push("REKOMENDUOJAMI (Premium):", ...devicesToLines(premiumList));
        if (budgetList.length) {
          blocks.push("", "GALIMI PIGESNI (Budget):", ...devicesToLines(budgetList));
        }
      } else {
        if (budgetList.length) blocks.push("GALIMI PIGESNI (Budget):", ...devicesToLines(budgetList));
        if (premiumList.length) {
          blocks.push("", "REKOMENDUOJAMI (Premium):", ...devicesToLines(premiumList));
        }
      }
    } else {
      blocks.push(...devicesToLines(filteredAll));
    }

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

  /**
   * Paprasta lokali „AI“ dėžutė
   */
  function handleChatSend() {
    const q = chatInput.trim();
    if (!q) return;
    setChatMessages((p) => [...p, { sender: "Jūs", text: q }]);
    const low = q.toLowerCase();
    let a =
      "Ačiū! Užpildykite laukus viršuje – lentelė atsinaujins. Dėl tikslių skaičiavimų rekomenduojamas detalus šilumos nuostolių skaičiavimas.";
    if (low.includes("kiek kw") || low.includes("koks galingumas")) {
      a = `Apytikslis poreikis: ~${requiredKw} kW pagal jūsų plotą ir izoliaciją.`;
    } else if (low.includes("dujos")) {
      a =
        inputs.gasAvailable === "Taip"
          ? "Turint dujų įvadą, tinka kondensaciniai dujiniai katilai."
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

  /**
   * UI – minimalistinė apdaila (kortelės, tyli paletė, tvarkingi tarpai)
   */
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Viršus */}
      <header className="bg-white/70 backdrop-blur sticky top-0 z-10 border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
            Šildymo įrenginių parinkimo asistentas
          </h1>
          <div className="text-sm text-slate-500">Minimalus • Profesionalus • Aiškus</div>
        </div>
      </header>

      {/* Turinio dėklas */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Forma */}
        <section className="bg-white rounded-2xl shadow-sm border p-4 md:p-6 mb-6">
          <h2 className="text-lg font-medium mb-4">Objekto parametrai</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Pastato tipas</label>
              <select
                name="buildingType"
                className="border rounded-lg w-full p-2"
                value={inputs.buildingType}
                onChange={handleInputChange}
              >
                <option>Namas</option>
                <option>Butas</option>
                <option>Kotedžas</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">Bendras plotas (m²)</label>
              <input
                name="area"
                className="border rounded-lg w-full p-2"
                type="number"
                placeholder="pvz., 150"
                value={inputs.area}
                onChange={handleInputChange}
              />
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">Izoliacija</label>
              <select
                name="insulation"
                className="border rounded-lg w-full p-2"
                value={inputs.insulation}
                onChange={handleInputChange}
              >
                <option value="">— Pasirinkite —</option>
                <option>Labai gera (A+/A)</option>
                <option>Vidutinė (B/C)</option>
                <option>Silpna (D ir senesni)</option>
              </select>
              {inputs.area && inputs.insulation && (
                <p className="text-xs text-slate-500 mt-1">
                  Apytikslis poreikis: <strong>{requiredKw} kW</strong>
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">Ar yra dujų įvadas?</label>
              <div className="flex gap-6">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="gasAvailable"
                    value="Taip"
                    checked={inputs.gasAvailable === "Taip"}
                    onChange={handleInputChange}
                  />
                  Taip
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="gasAvailable"
                    value="Ne"
                    checked={inputs.gasAvailable === "Ne"}
                    onChange={handleInputChange}
                  />
                  Ne
                </label>
              </div>
              {showGasNearby && (
                <label className="inline-flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    name="gasLineNearby"
                    checked={inputs.gasLineNearby}
                    onChange={handleInputChange}
                  />
                  Ar yra dujų trasa šalia?
                </label>
              )}
            </div>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="ownPowerPlant"
                checked={inputs.ownPowerPlant}
                onChange={handleInputChange}
              />
              Yra nuosava elektrinė
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="solarPanels"
                checked={inputs.solarPanels}
                onChange={handleInputChange}
              />
              Yra saulės baterijos
            </label>

            <div>
              <label className="block text-sm text-slate-600 mb-1">Karšto vandens ruošimas</label>
              <select
                name="dhwType"
                className="border rounded-lg w-full p-2"
                value={inputs.dhwType}
                onChange={handleInputChange}
              >
                <option value="">— Pasirinkite —</option>
                <option>Integruotas boileris</option>
                <option>Atskiras boileris</option>
                <option>Nereikia</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">Biudžetas (€)</label>
              <input
                name="budget"
                className="border rounded-lg w-full p-2"
                type="number"
                placeholder="pvz., 5000"
                value={inputs.budget}
                onChange={handleInputChange}
              />
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">Jūsų el. paštas (kontaktui)</label>
              <input
                name="email"
                className="border rounded-lg w-full p-2"
                type="email"
                placeholder="vardas@pastas.lt"
                value={inputs.email}
                onChange={handleInputChange}
              />
            </div>
          </div>
        </section>

        {/* Valdikliai + rūšiavimas */}
        <section className="bg-white rounded-2xl shadow-sm border p-4 md:p-6 mb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-lg font-medium">Siūlomi įrenginiai</h2>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">Rūšiuoti pagal:</label>
              <select
                className="border rounded-lg p-2"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="best">Geriausias atitikimas</option>
                <option value="price_asc">Kaina ↑</option>
                <option value="price_desc">Kaina ↓</option>
                <option value="power_asc">Galia ↑</option>
                <option value="power_desc">Galia ↓</option>
              </select>
            </div>
          </div>

          {/* LENTELĖS */}
          {!hasTiers && (
            <DeviceTable list={commonList} />
          )}

          {hasTiers && (
            <>
              {/* Logika: esant dideliam biudžetui – Premium pirma, po to Budget */}
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

              {/* Mažas biudžetas – pirmiausia Budget */}
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
            <button
              onClick={handleGetQuote}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 font-medium shadow"
            >
              Gauti pasiūlymą
            </button>

            <button
              onClick={() => setShowBetterOffer(true)}
              className="inline-flex items-center justify-center rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 px-4 py-2 font-medium border border-amber-200"
            >
              ⚠️ Neskubėkite pirkti! Galbūt mes galime pateikti jums geresnį pasiūlymą.
            </button>
          </div>

          {/* Paaiškinimas */}
          <p className="text-sm text-slate-500 mt-3">
            Mes rekomenduojame Premium gamintojus dėl efektyvumo (SCOP), darbo prie šalčio (min. darbinė
            temperatūra), patikimumo ir serviso. Pigesni variantai galimi, jei biudžetas ribotas.
          </p>
        </section>

        {/* AI dėžutė */}
        <section className="bg-white rounded-2xl shadow-sm border p-4 md:p-6">
          <h2 className="text-lg font-medium mb-3">AI pokalbių dėžutė</h2>
          <div className="h-44 overflow-y-auto border rounded-lg p-3 bg-slate-50">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className="mb-1">
                <strong className={msg.sender === "AI" ? "text-slate-600" : "text-slate-900"}>
                  {msg.sender}:
                </strong>{" "}
                {msg.text}
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 border rounded-lg p-2"
              placeholder="Jūsų klausimas apie šildymą…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleChatSend()}
            />
            <button
              onClick={handleChatSend}
              className="rounded-xl bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 font-medium"
            >
              Siųsti
            </button>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="py-8 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} Jūsų įmonė • Šildymo sprendimai
      </footer>

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
              <button
                onClick={() => handleBetterOffer(true)}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 font-medium"
              >
                Taip, noriu geresnio pasiūlymo su montavimu
              </button>
              <button
                onClick={() => handleBetterOffer(false)}
                className="rounded-xl bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 font-medium"
              >
                Taip, noriu geresnio pasiūlymo be montavimo
              </button>
              <button
                onClick={() => setShowBetterOffer(false)}
                className="rounded-xl bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 font-medium border"
              >
                Atšaukti
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              * Laiške bus pridėtas jūsų el. paštas ir šiuo metu automatiškai atrinkti įrenginiai.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Lentelės komponentas – švarus ir kompaktiškas
 */
function DeviceTable({ list }) {
  if (!list || list.length === 0) {
    return (
      <div className="border rounded-xl p-4 text-center text-slate-400">
        Nėra tinkamų įrenginių pagal pasirinktus kriterijus.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto border rounded-xl">
      <table className="w-full text-sm">
        <thead className="bg-slate-100">
          <tr>
            <Th>Tipas</Th>
            <Th>Modelis</Th>
            <Th>Kuras</Th>
            <Th center>Galia (kW)</Th>
            <Th center>Kaina</Th>
            <Th>Argumentai</Th>
            <Th>Pardavėjai</Th>
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
              <Td center>
                {d.power_kw != null
                  ? d.power_kw
                  : `${d.power_kw_min ?? "?"}–${d.power_kw_max ?? "?"}`}
              </Td>
              <Td center>{eur(d.price_eur)}</Td>
              <Td>
                {/* Argumentuota santrauka: SCOP / COP / min temp / šaltnešis */}
                <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                  {d.scop && <li>SCOP {d.scop}</li>}
                  {d.cop && <li>COP {d.cop}</li>}
                  {d.min_temp != null && <li>Darbas iki {d.min_temp} °C</li>}
                  {d.refrigerant && <li>Šaltnešis {d.refrigerant}</li>}
                  {d.notes && <li>{d.notes}</li>}
                </ul>
              </Td>
              <Td>
                {(d.vendors || []).map((v, idx) => (
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    key={idx}
                    className="text-blue-600 underline mr-2"
                    title={v.email || ""}
                  >
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
  return (
    <th className={`p-2 border-b text-left ${center ? "text-center" : ""}`}>{children}</th>
  );
}
function Td({ children, center }) {
  return <td className={`p-2 align-top ${center ? "text-center" : ""}`}>{children}</td>;
}
