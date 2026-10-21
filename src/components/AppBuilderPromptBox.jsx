import { useState } from "react";

export default function AppBuilderPromptBox() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  const handleBuild = async () => {
    if (!prompt.trim()) return alert("Pehle prompt likho!");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });
      const data = await res.json();
      alert("AI Reply: " + (data.reply || "Ho gaya!"));
    } catch (e) {
      alert("Error: " + e.message);
    }
    setLoading(false);
  };

  return (
    <div className="bg-[#1a1d29] p-6 rounded-xl border border-yellow-500/20 max-w-2xl mx-auto my-10">
      <h2 className="text-2xl font-bold text-yellow-400 mb-2">
        App Builder - Prompt Box
      </h2>
      <p className="text-gray-400 text-sm mb-4">
        Likho kya app chahiye, AI bana dega
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. mujhe aik todo app chahiye jisme login ho..."
        className="w-full h-32 bg-[#0a1128] p-4 rounded-lg text-white border border-gray-700 outline-none"
      />
      <button
        onClick={handleBuild}
        className="mt-4 w-full bg-yellow-500 text-black py-3 rounded-lg font-bold"
      >
        {loading ? "Building..." : "Build Karo →"}
      </button>
    </div>
  );
}
