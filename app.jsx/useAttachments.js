import { useCallback, useState } from "react";

export function useAttachments({
  maxFiles = 4,
  maxBytes = 5 * 1024 * 1024,
} = {}) {
  const [files, setFiles] = useState([]); // [{ id, file }]
  const [error, setError] = useState("");

  const add = useCallback(
    (picked) => {
      const incoming = Array.from(picked || []);
      if (incoming.length === 0) return;

      setError("");
      setFiles((previous) => {
        const next = [...previous];
        for (const file of incoming) {
          if (next.length >= maxFiles) {
            setError(`Maximum ${maxFiles} files allowed.`);
            break;
          }
          if (file.size > maxBytes) {
            setError(`${file.name} bohat bari hai (max ${Math.round(maxBytes / 1048576)}MB).`);
            continue;
          }
          next.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            file,
          });
        }
        return next;
      });
    },
    [maxFiles, maxBytes],
  );

  const remove = useCallback((id) => {
    setFiles((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    setFiles([]);
    setError("");
  }, []);

  return { files, add, remove, clear, error };
}

export default useAttachments;
