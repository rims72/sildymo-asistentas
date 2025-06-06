import React, { useState, useEffect } from "react";
import devices from "./devices.json";

function HeatingAssistant() {
  const [inputs, setInputs] = useState({
    houseType: "",
    area: "",
    gasAvailable: false,
    ownPowerPlant: false,
    solarPanels: false,
    budget: "",
    email: ""
  });
  const [filteredDevices, setFilteredDevices] = useState([]);
  const [chatMessages, setChatMessages] = useState([
    { sender: "AI", text: "Sveiki! Užduokite bet kokį klausimą apie šildymą." }
  ]);
  const [chatInput, setChatInput] = useState("");

  useEffect(() => {
    let result = devices.filter((d) => {
      if (!inputs.gasAvailable && d.gas_required) return false;
      if (inputs.ownPowerPlant && !d.own_power_plant_required && d.type.includes("Siurblys")) return true;
      if (inputs.solarPanels && !d.solar_compatible) return false;
      if (inputs.budget && d.price_eur > parseInt(inputs.budget)) return false;
      return true;
    });
    setFilteredDevices(result);
  }, [inputs]);

  function handleInputChange(e) {
    const { name, value, type, checked } = e.target;
    setInputs((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value
    }));
  }

  function handleSendProposal() {
    const body = `
Sveiki,

Prašau pateikti šildymo įrenginio pasiūlymą pagal šiuos kriterijus:
- Namo tipas: ${inputs.houseType}
- Plotas: ${inputs.area} m2
- Dujos: ${inputs.gasAvailable ? "Yra" : "Nėra"}
- Nuosava elektrinė: ${inputs.ownPowerPlant ? "Yra" : "Nėra"}
- Saulės baterijos: ${inputs.solarPanels ? "Yra" : "Nėra"}
- Biudžetas: ${inputs.budget} €
- Pageidaujami įrenginiai: ${filteredDevices.map((d) => d.brand).join(", ")}

Ačiū.
    `.trim();

    window.location.href = `mailto:${inputs.email || ""}?subject=Šildymo įrenginio pasiūlymą&body=${encodeURIComponent(body)}`;
  }

  function handleChatSend() {
    if (!chatInput) return;
    setChatMessages((prev) => [...prev, { sender: "Jūs", text: chatInput }]);
    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        { sender: "AI", text: "Ačiū už klausimą! Šiuo metu AI dėžutė yra demonstracinė." }
      ]);
    }, 1000);
    setChatInput("");
  }

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white rounded-2xl shadow-2xl">
      <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
        Šildymo įrenginių parinkimo asistentas
      </h1>
      <div className="grid grid-cols-1 gap-4 mb-4">
        <input
          name="houseType"
          className="border p-2 rounded"
          placeholder="Namo tipas (pvz. namas, butas, kotedžas)"
          value={inputs.houseType}
          onChange={handleInputChange}
        />
        <input
          name="area"
          className="border p-2 rounded"
          placeholder="Bendras plotas (m2)"
          type="number"
          value={inputs.area}
          onChange={handleInputChange}
        />
        <label className="flex items-center">
          <input
            type="checkbox"
            name="gasAvailable"
            checked={inputs.gasAvailable}
            onChange={handleInputChange}
          />
          <span className="ml-2">Yra dujų įvadas</span>
        </label>
        <label className="flex items-center">
          <input
            type="checkbox"
            name="ownPowerPlant"
            checked={inputs.ownPowerPlant}
            onChange={handleInputChange}
          />
          <span className="ml-2">Yra nuosava elektrinė</span>
        </label>
        <label className="flex items-center">
          <input
            type="checkbox"
            name="solarPanels"
            checked={inputs.solarPanels}
            onChange={handleInputChange}
          />
          <span className="ml-2">Yra saulės baterijos</span>
        </label>
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
          placeholder="Jūsų el. paštas"
          type="email"
          value={inputs.email}
          onChange={handleInputChange}
        />
      </div>
      <h2 className="text-xl font-semibold mt-4 mb-2">Siūlomi įrenginiai</h2>
      <div className="overflow-x-auto">
        <table className="w-full border mb-2">
          <thead>
            <tr className="bg-gray-200">
              <th className="p-2 border">Tipas</th>
              <th className="p-2 border">Modelis</th>
              <th className="p-2 border">Galia (kW)</th>
              <th className="p-2 border">Kaina (€)</th>
              <th className="p-2 border">Pardavėjai</th>
            </tr>
          </thead>
          <tbody>
            {filteredDevices.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-4 text-gray-400">
                  Nėra tinkamų įrenginių pagal pasirinktus kriterijus.
                </td>
              </tr>
            )}
            {filteredDevices.map((d) => (
              <tr key={d.id}>
                <td className="border p-2">{d.type}</td>
                <td className="border p-2">{d.brand}</td>
                <td className="border p-2 text-center">{d.power_kw}</td>
                <td className="border p-2 text-center">{d.price_eur}</td>
                <td className="border p-2">
                  {d.vendors.map((v, idx) => (
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      key={idx}
                      className="text-blue-600 underline mr-2"
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

export default HeatingAssistant;
