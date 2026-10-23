import { useRef } from "react";

export default function AttachButton({
  onPick,
  disabled = false,
  accept = "image/*,.pdf,.txt,.md,.csv,.json",
}) {
  const inputRef = useRef(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={accept}
        onChange={(event) => {
          const picked = Array.from(event.target.files || []);
          event.target.value = ""; // same file dobara chunna possible ho
          if (picked.length) onPick?.(picked);
        }}
      />
      <button
        type="button"
        className="gm-btn"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach files"
        title="File attach karein"
      >
        📎
      </button>
    </>
  );
}
