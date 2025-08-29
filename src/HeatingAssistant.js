import React, { useState, useMemo, useRef } from "react";
import devices from "./devices.json";

function estimateRequiredKw(area, insulation) {
  const A = Number(area) || 0;
  const coefMap = {
    "Labai gera (A+/A)": 0.045, // kW/m² (apytiksliai)
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

export default function HeatingAssistant() {
  const [inputs, setInputs] = useState({
    buildingType: "Namas",
    area: "",
    insulation: "",
    gasAvailable: "Ne", // "Taip" | "Ne"
    gasLineNearby: false,
    ownPowerPlant: false,
    solarPanels: false,
    buildYear: "",
    dhwType: "", // "Integruotas boileris" | "Atskiras boileris" | "Nereikia"
    budget: "",
    email: "",
  });

  const [chatMessages, setChatMessages] = useState([
    { sender: "AI", text: "Sveiki! Užduokite bet kokį klausimą apie šildymą." },
  ]);
  const [chatInput, setChatInput] = useState("");

  // Nauja: rūšiavimas
  const [sortBy, setSortBy] = useState("best"); // best | price_asc | price_desc | power_asc | power_desc

  const printRef = useRef(null);

  const showGasNearby = inputs.gasAvailable === "Ne";

  const budgetNum = useMemo(() => {
    const n = parseInt(String(inputs.budget).replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : undefined;
  }, [inputs.budget]);

  const requiredKw = useMemo(
    () => estimateRequiredKw(inputs.area, inputs.insulation),
    [inputs.area, inputs.insulation]
  );

  const filteredDevices = useMemo(() => {
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

    // 3) DHW tipas
    if (inputs.dhwType) {
      list = list.filter((d) => {
        if (!d.dhw) return inputs.dhwType === "Nereikia";
        if (inputs.dhwType === "Nereikia") return d.dhw === "none";
        if (inputs.dhwType === "Integruotas boileris") return d.dhw === "integruotas";
        if (inputs.dhwType === "Atskiras boileris") return d.dhw === "atskiras";
        return true;
      });
    }

    // 4) Galia – turi apytiksliai dengti poreikį
    const need = requiredKw || 0;
    list = list.filter((d) => {
      const pk = d.power_kw;
      const pmin = d.power_kw_min ?? pk ?? 0;
      const pmax = d.power_kw_max ?? pk ?? 0;
      if (!need) return true;
      if (pmin === pmax) {
        return pmin >= need * 0.8 && pmin <= need * 1.5;
      }
      return need >= pmin * 0.7 && need <= pmax * 1.3;
    });

    // 5) Biudžetas
    if (budgetNum) {
      list = list.filter((d) => (d.price_eur ?? Infinity) <= budgetNum);
    }

    // 6) Score „geriausias atitikimas“
    list = list.map((d) => {
      const ref = d.power_kw ?? d.power_kw_min ?? need;
      const score =
        Math.abs((ref || need) - need) + (d.price_eur || 999999) / 100000;
      return { ...d, _score: score };
    });

    // 7) Rūšiavimas
    switch (sortBy) {
      case "price_asc":
        list.sort((a, b) => (a.price_eur || 9e9) - (b.price_eur || 9e9));
        break;
      case "price_desc":
        list.sort((a, b) => (b.price_eur || -1) - (a.price_eur || -1));
        break;
      case "power_asc": {
        const p = (d) => d.power_kw ?? d.power_kw_min ?? d.power_kw_max ?? 0;
        list.sort((a, b) => p(a) - p(b));
        break;
      }
      case "power_desc": {
        const p = (d) => d.power_kw ?? d.power_kw_min ?? d.power_kw_max ?? 0;
        list.sort((a, b) => p(b) - p(a));
        break;
      }
      default:
        list.sort((a, b) => a._score - b._score);
    }

    return list;
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

  function handleInputChange(e) {
    const { name, value, type, checked } = e.target;
    setInputs((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function handleSendProposal() {
    const top = filteredDevices.slice(0, 3);
    const subject = "Užklausa dėl šildymo įrenginio pasiūlymo";
    const bodyLines = [
      "Sveiki,",
      "",
      "Prašau pateikti pasiūlymą šiems įrenginiams:",
      ...top.map(
        (d, i) =>
          `${i + 1}) ${d.brand} ${d.model} (${d.type}), galia: ${
            d.power_kw_max ?? d.power_kw ?? d.power_kw_min ?? "?"
          } kW, kaina: ${d.price_eur ? eur(d.price_eur) : "n/a"}`
      ),
      "",
      "Objekto duomenys:",
      `- Pastato tipas: ${inputs.buildingType}`,
      `- Plotas: ${inputs.area || "?"} m²`,
      `- Izoliacija: ${inputs.insulation || "?"}`,
      `- Dujos: ${inputs.gasAvailable}${
        inputs.gasAvailable === "Ne"
          ? `, trasa šalia: ${inputs.gasLineNearby ? "Taip" : "Ne"}`
          : ""
      }`,
      `- Nuosava elektrinė: ${inputs.ownPowerPlant ? "Yra" : "Nėra"}`,
      `- Saulės baterijos: ${inputs.solarPanels ? "Yra" : "Nėra"}`,
      `- Karšto vandens ruošimas: ${inputs.dhwType || "Nenurodyta"}`,
      `- Biudžetas: ${inputs.budget || "Nenurodytas"}`,
      "",
      "Ačiū!",
      inputs.email ? `Kontaktinis el. paštas: ${inputs.email}` : "",
    ].join("\n");

    const emails = new Set();
    top.forEach((d) => (d.vendors || []).forEach((v) => v.email && emails.add(v.email)));
    const to = encodeURIComponent(Array.from(emails).join(","));
    const href = `mailto:${to}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(bodyLines)}`;
    window.location.href = href;
  }

  function handleChatSend() {
    if (!chatInput.trim()) return;
    const q = chatInput.trim();
    setChatMessages((prev) => [...prev, { sender: "Jūs", text: q }]);

    let a =
      "Ačiū už klausimą! Dėžutė veikia lokaliai ir pateikia bendro pobūdžio atsakymus. Užpildykite laukus viršuje – lentelė iškart atsinaujina.";
    const low = q.toLowerCase();
    if (low.includes("kiek kw") || low.includes("koks galingumas")) {
      a = `Apytikslis poreikis: ~${requiredKw} kW pagal jūsų plotą ir izoliaciją. Projektiniams skaičiavimams reikia detalesnio šilumos nuostolių skaičiavimo.`;
    } else if (low.includes("dujos")) {
      a =
        inputs.gasAvailable === "Taip"
          ? "Turint dujų įvadą, dažnai tinka kondensaciniai dujiniai katilai."
          : showGasNearby
          ? "Dujų įvado nėra. Jei trasa šalia, jungtis galima; kitu atveju – granulės ar šilumos siurblys."
          : "Dujų įvado nėra. Rekomenduojama svarstyti granules, kietą kurą arba šilumos siurblį.";
    } else if (low.includes("saul")) {
      a = inputs.solarPanels
        ? "Turint saulės modulius, šilumos siurblys ar elektrinis katilas gali sumažinti sąnaudas."
        : "Be saulės modulių šilumos siurblys vis tiek efektyvus, bet elektros kaina reikšminga.";
    }

    setChatMessages((prev) => [...prev, { sender: "AI", text: a }]);
    setChatInput("");
  }

  // CSV eksportas
  function exportCSV() {
    const header = [
      "Tipas",
      "Gamintojas",
      "Modelis",
      "Kuras",
      "Galia_kW",
      "Kaina_EUR",
      "DHW",
      "Pardavejai"
    ];
    const rows = filteredDevices.map((d) => [
      d.type || "",
      d.brand || "",
      d.model || "",
      d.fuel || "",
      d.power_kw ?? `${d.power_kw_min ?? ""}-${d.power_kw_max ?? ""}`,
      d.price_eur ?? "",
      d.dhw || "",
      (d.vendors || []).map((v) => v.name).join(" | "),
    ]);
    const csv = [header, ...rows].map((r) => r.map(escapeCSV).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sirenkami_irenginiai.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  function escapeCSV(v) {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  // Spausdinimas → PDF (naudojamas naršyklės „Print…“)
  function printPDF() {
    const el = printRef.current;
    if (!el) return;
    // Pridedam/nuimam klasę, kad spaudinyje būtų tik lentelė ir antraštė
    document.body.classList.add("print-mode");
    window.print();
    setTimeout(() => document.body.classList.remove("print-mode"), 500);
  }

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white rounded-2xl shadow-2xl">
      <h1 className="text-2xl font-bold mb-4">Šildymo įrenginių parinkimo asistentas</h1>

      {/* Forma */}
      <div className="grid grid-cols-1 gap-4 mb-4">
        <div>
          <label className="block text-sm text-gray-700 mb-1">Pastato tipas</label>
          <select
            name="buildingType"
            className="border p-2 rounded w-full"
            value={inputs.buildingType}
            onChange={handleInputChange}
          >
            <option>Namas</option>
            <option>Butas</option>
            <option>Kotedžas</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Bendras plotas (m²)</label>
          <input
            name="area"
            className="border p-2 rounded w-full"
            type="number"
            placeholder="pvz., 150"
            value={inputs.area}
            onChange={handleInputChange}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Izoliacija</label>
          <select
            name="insulation"
            className="border p-2 rounded w-full"
            value={inputs.insulation}
            onChange={handleInputChange}
          >
            <option value="">— Pasirinkite —</option>
            <option>Labai gera (A+/A)</option>
            <option>Vidutinė (B/C)</option>
            <option>Silpna (D ir senesni)</option>
          </select>
          {inputs.area && inputs.insulation && (
            <p className="text-xs text-gray-500 mt-1">
              Apytikslis poreikis: <strong>{requiredKw} kW</strong>
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Ar yra dujų įvadas?</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="gasAvailable"
                value="Taip"
                checked={inputs.gasAvailable === "Taip"}
                onChange={handleInputChange}
              />
              Taip
            </label>
            <label className="flex items-center gap-2">
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
            <label className="flex items-center gap-2 mt-2">
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

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="ownPowerPlant"
            checked={inputs.ownPowerPlant}
            onChange={handleInputChange}
          />
          Yra nuosava elektrinė
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="solarPanels"
            checked={inputs.solarPanels}
            onChange={handleInputChange}
          />
          Yra saulės baterijos
        </label>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Karšto vandens ruošimas</label>
          <select
            name="dhwType"
            className="border p-2 rounded w-full"
            value={inputs.dhwType}
            onChange={handleInputChange}
          >
            <option value="">— Pasirinkite —</option>
            <option>Integruotas boileris</option>
            <option>Atskiras boileris</option>
            <option>Nereikia</option>
          </select>
        </div>

        <input
          name="budget"
          className="border p-2 rounded"
          placeholder="Biudžetas (€)"
          type="number"
          value={inputs.budget}
          onChange={handleInputChange}
        />
        <input
          name="email"
          className="border p-2 rounded"
          placeholder="Jūsų el. paštas (siūlymui)"
          type="email"
          value={inputs.email}
          onChange={handleInputChange}
        />
      </div>

      {/* Valdikliai virš lentelės */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h2 className="text-xl font-semibold">Siūlomi įrenginiai</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700">Rūšiuoti pagal:</label>
          <select
            className="border p-2 rounded"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="best">Geriausias atitikimas</option>
            <option value="price_asc">Kaina ↑</option>
            <option value="price_desc">Kaina ↓</option>
            <option value="power_asc">Galia ↑</option>
            <option value="power_desc">Galia ↓</option>
          </select>
          <button
            onClick={exportCSV}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-2 rounded-2xl border"
          >
            Eksportuoti CSV
          </button>
          <button
            onClick={printPDF}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-2 rounded-2xl border"
          >
            Spausdinti / PDF
          </button>
        </div>
      </div>

      {/* Lentelė (taip pat spausdinamas turinys) */}
      <div ref={printRef} className="overflow-x-auto">
        <table className="w-full border mb-2">
          <thead>
            <tr className="bg-gray-200">
              <th className="p-2 border">Tipas</th>
              <th className="p-2 border">Modelis</th>
              <th className="p-2 border">Kuras</th>
              <th className="p-2 border">Galia (kW)</th>
              <th className="p-2 border">Kaina (€)</th>
              <th className="p-2 border">Pardavėjai</th>
            </tr>
          </thead>
          <tbody>
            {filteredDevices.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-4 text-gray-400">
                  Nėra tinkamų įrenginių pagal pasirinktus kriterijus.
                </td>
              </tr>
            )}
            {filteredDevices.map((d) => (
              <tr key={d.id}>
                <td className="border p-2">{d.type}</td>
                <td className="border p-2">
                  {d.brand} {d.model}
                </td>
                <td className="border p-2">{d.fuel}</td>
                <td className="border p-2 text-center">
                  {d.power_kw ?? (d.power_kw_min + "–" + d.power_kw_max)}
                </td>
                <td className="border p-2 text-center">{eur(d.price_eur)}</td>
                <td className="border p-2">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Spausdinimui – papildoma suvestinė */}
        <div className="mt-4 text-sm text-gray-700">
          <p><strong>Objekto suvestinė:</strong></p>
          <p>Tipas: {inputs.buildingType} | Plotas: {inputs.area || "?"} m² | Izoliacija: {inputs.insulation || "?"}</p>
          <p>
            Dujos: {inputs.gasAvailable}
            {inputs.gasAvailable === "Ne" ? `, trasa šalia: ${inputs.gasLineNearby ? "Taip" : "Ne"}` : ""}
            {" | "}PV: {inputs.solarPanels ? "Taip" : "Ne"} | Nuosava el.: {inputs.ownPowerPlant ? "Taip" : "Ne"}
          </p>
          <p>DHW: {inputs.dhwType || "Nenurodyta"} | Biudžetas: {inputs.budget || "Nenurodytas"}</p>
        </div>
      </div>

      <button
        onClick={handleSendProposal}
        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-2xl shadow-lg mt-4 mb-6"
      >
        Gauti pasiūlymą
      </button>

      {/* AI dėžutė */}
      <div className="bg-gray-50 p-4 rounded-xl shadow mt-4">
        <h2 className="text-lg font-semibold mb-2">AI pokalbių dėžutė</h2>
        <div className="h-40 overflow-y-auto border p-2 rounded mb-2 bg-white">
          {chatMessages.map((msg, idx) => (
            <div
              key={idx}
              className={
                msg.sender === "AI" ? "text-gray-600 mb-1" : "text-black font-semibold mb-1"
              }
            >
              <strong>{msg.sender}:</strong> {msg.text}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 border p-2 rounded"
            placeholder="Jūsų klausimas apie šildymą..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleChatSend()}
          />
          <button
            onClick={handleChatSend}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-4 py-2 rounded-2xl"
          >
            Siųsti
          </button>
        </div>
      </div>

      {/* Spausdinimo stiliai */}
      <style>{`
        @media print {
          body.print-mode * {
            visibility: hidden !important;
          }
          body.print-mode .print-only,
          body.print-mode table,
          body.print-mode table *,
          body.print-mode .mt-4,
          body.print-mode .mt-4 * {
            visibility: visible !important;
            color: #000 !important;
          }
          body.print-mode .max-w-3xl {
            box-shadow: none !important;
          }
          body.print-mode .max-w-3xl {
            position: absolute; left: 0; top: 0; width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
