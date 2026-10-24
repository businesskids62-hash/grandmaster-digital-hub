// scripts/test-live-gemini.js
async function run() {
  const res = await fetch("http://localhost:5000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello! Say: Grandmaster Phase 3 live test OK." }),
  });
  const data = await res.json();
  console.log("STATUS:", res.status);
  console.log("DATA:", JSON.stringify(data, null, 2));
}

run().catch((e) => console.error("Error:", e.message));
