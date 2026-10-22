function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

async function askGrandmaster(message, history = [], files = []) {
  const attachments = await Promise.all(
    files.map(async (item) => {
      const file = item.file || item; // useAttachments ke shape ke mutabiq
      return {
        name: file.name,
        type: file.type,
        data: await fileToBase64(file),
      };
    }),
  );

  const data = await apiRequest("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      attachments,
      history: history.slice(-12).map((item) => ({
        role: item.role === "user" ? "user" : "assistant",
        content: item.text,
      })),
    }),
  });

  const reply = data.reply || data.response || data.message;
  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("Backend returned no assistant response.");
  }
  return reply;
}
