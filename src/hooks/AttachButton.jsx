import { useRef, useState } from "react";

export default function AttachButton({ onPick }) {
  const [open, setOpen] = useState(false);
  const gallery = useRef(),
    camera = useRef(),
    doc = useRef();

  const handle = (e) => {
    onPick(e.target.files);
    e.target.value = "";
    setOpen(false);
  };

  const item = {
    display: "block",
    width: "100%",
    padding: "10px 14px",
    background: "none",
    border: 0,
    color: "inherit",
    textAlign: "left",
    cursor: "pointer",
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          fontSize: 22,
          background: "none",
          border: 0,
          cursor: "pointer",
        }}
      >
        📎
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: 46,
            left: 0,
            background: "#1f2937",
            color: "#fff",
            borderRadius: 12,
            minWidth: 150,
            boxShadow: "0 4px 16px #0006",
            zIndex: 50,
          }}
        >
          <button style={item} onClick={() => gallery.current.click()}>
            🖼️ Gallery
          </button>
          <button style={item} onClick={() => camera.current.click()}>
            📷 Camera
          </button>
          <button style={item} onClick={() => doc.current.click()}>
            📄 File / PDF
          </button>
        </div>
      )}
      <input
        ref={gallery}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handle}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={handle}
      />
      <input
        ref={doc}
        type="file"
        accept=".pdf,.txt,.md,.csv,.json"
        hidden
        onChange={handle}
      />
    </div>
  );
}
