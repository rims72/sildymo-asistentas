import React, { useState, useMemo } from "react";
import devices from "./devices.json";

function estimateRequiredKw(area, insulation) {
  const A = Number(area) || 0;
  const coefMap = {
    "Labai gera (A+/A)": 0.045, // kW/m² (apytiksliai)
    "Vidutinė (B/C)": 0.06,
    "Silpna (D ir senesni)": 0.085,
  };
  const coef = coefMap[insulation] ?? 0.06;
  const kw = Math.max(5, Math.round(A * coef));
  return kw;
}

function eur(v) {
  if (v == null) return "-";
  try {
    return new Intl.NumberFormat("lt-LT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  } catch {
    return v + " €";
  }
}

export default function HeatingAssistant() {
  const [inputs, setInputs] = useState({
    buildingType: "Namas",
    area: "",
    insulation: "",
    gasAvailable: "Ne",           // "Taip" | "Ne"
    gasLineNearby: false,         // rodomas tik kai gasAvailable === "Ne"
    ownPowerPlant: false,
    solarPanels: false,
    buildYear: "",
    dhwType: "",                  // "Integruotas boileris" | "Atskiras boileris" | "Nereikia"
    budget: "",
    email: "",
  });

  const [chatMessages, setChatMessages] = useState([
    { sender: "AI", text: "Sveiki! Užduokite bet kokį klausimą apie šildymą." },
  ]);
  const [chatInput, setChatInput] = useState("");

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
        // dujinis galimas jei yra įvadas, arba nėra įvado, bet trasa šalia (ekonomiškai galima jungtis)
        if (inputs.gasAvailable === "Taip") return true;
        if (inputs.gasAvailable === "Ne" && inputs.gasLineNearby) return true;
        return false;
      }
      return true; // kiti kurai – visada galimi
    });

    // 2) Saulės suderinamumas
    if (inputs.solarPanels && list.length) {
      list = list.filter((d) => d.solar_compatible !== false);
    }

    // 3) Nuosava elektrinė (preferuojame elektrą / šilumos siurblį, bet nekertame kitų)
    // Jei labai norisi – čia galima pridėti svorio/rūšiavimą, bet filtro nedarome.

    // 4) DHW tipas
    if (inputs.dhwType) {
      list = list.filter((d) => {
        if (!d.dhw) return inputs.dhwType === "Nereikia";
        if (inputs.dhwType === "Nereikia") return d.dhw === "none";
        if (inputs.dhwType === "Integruotas boileris") return d.dhw === "integruotas";
        if (inputs.dhwType === "Atskiras boileris") return d.dhw === "atskiras";
        return true;
      });
    }

    // 5) Galia – atrenkame, kad įrenginio galia apytiksliai dengtų poreikį
    const need = requiredKw || 0;
    list = list.filter((d) => {
      const pk = d.power_kw;
      const pmin = d.power_kw_min ?? pk ?? 0;
      const pmax = d.power_kw_max ?? pk ?? 0;
      if (!need) return true;
      // viengubas skaičius
      if (pmin === pmax) {
        return pmin >= need * 0.8 && pmin <= need * 1.5;
      }
      // intervalas
      return need >= pmin * 0.7 && need <= pmax * 1.3;
    });

    // 6) Biudžetas
    if (budgetNum) list = list.filter((d) => (d.price_eur ?? Infinity) <= budgetNum);

    // 7) Rūšiavimas: arčiausiai poreikio esanti galia, po to kaina
    list = list
      .map((d) => {
        const ref = d.power_kw ?? d.power_kw_min ?? need;
        const score = Math.abs((ref || need) - need) + (d.price_eur || 999999) / 100000;
        return { ...d, _score: score };
      })
      .sort((a, b) => a._score - b._score);

    return list;
  }, [devices, inputs.gasAvailable, inputs.gasLineNearby, inputs.solarPanels, inputs.dhwType, requiredKw, budgetNum]);

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
        inputs.gasAvailable === "Ne" ? `, trasa šalia: ${inputs.gasLineNearby ? "Taip" : "Ne"}` : ""
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
    const href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines)}`;
    window.location.href = href;
  }

  function handleChatSend() {
    if (!chatInput.trim()) return;
    const q = chatInput.trim();
    setChatMessages((prev) => [...prev, { sender: "Jūs", text: q }]);

    let a =
      "Ačiū už klausimą! Dėžutė veikia lokaliai ir pateikia bendro pobūdžio atsakymus. Užpildykite laukus viršuje – lentelė iškart atnaujinama.";
    const low = q.toLowerCase();
    if (low.includes("kiek kw") || low.includes("koks galingumas")) {
      a = `Apytikslis poreikis: ~${requiredKw} kW pagal jūsų plotą ir izoliaciją. Projektiniams skaičiavimams reikia detalesnio šilumos nuostolių vertinimo.`;
    } else if (low.includes("dujos")) {
      a =
        inputs.gasAvailable === "Taip"
          ? "Turint dujų įvadą, dažniausiai tinka kondensaciniai dujiniai katilai."
          : showGasNearby
          ? "Dujų įvado nėra. Jei trasa šalia, jungtis įmanoma; kitu atveju – granulės ar šilumos siurblys."
          : "Dujų įvado nėra. Rekomenduojama svarstyti granules, kietą kurą arba šilumos siurblį.";
    } else if (low.includes("saul")) {
      a = inputs.solarPanels
        ? "Turint saulės modulius, šilumos siurblys ar elektrinis katilas tampa patrauklesni."
        : "Be saulės modulių šilumos siurblys vis tiek labai efektyvus, bet elektros kaina svarbi.";
    }

    setChatMessages((prev) => [...prev, { sender: "AI", text: a }]);
    setChatInput("");
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

      {/* Lentelė */}
      <h2 className="text-xl font-semibold mt-4 mb-2">Siūlomi įrenginiai</h2>
      <div className="overflow-x-auto">
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
                <td className="border p-2">{d.brand} {d.model}</td>
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
      </div>

      <button
        onClick={handleSendProposal}
        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-2xl shadow-lg mb-6"
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
              className={msg.sender === "AI" ? "text-gray-600 mb-1" : "text-black font-semibold mb-1"}
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
    </div>
  );
}
