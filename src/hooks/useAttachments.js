import { useState } from "react";

const MAX_MB = 10;

const toBase64 = (f) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

export function useAttachments() {
  const [files, setFiles] = useState([]);

  const add = async (list) => {
    const out = [];
    for (const f of Array.from(list || [])) {
      if (f.size > MAX_MB * 1024 * 1024) {
        alert(`${f.name} ${MAX_MB}MB se bari hai`);
        continue;
      }
      out.push({
        name: f.name,
        mimeType: f.type || "application/octet-stream",
        data: await toBase64(f),
        preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      });
    }
    setFiles((p) => [...p, ...out].slice(0, 5));
  };

  const remove = (i) => setFiles((p) => p.filter((_, x) => x !== i));
  const clear = () => setFiles([]);

  return { files, add, remove, clear };
}
