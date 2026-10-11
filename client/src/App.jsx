import { useEffect, useState } from "react";
const API = import.meta.env.VITE_API_URL;

export default function App() {
  const [health, setHealth] = useState("checking...");
  useEffect(() => {
    fetch(`${API}/health`).then(r => r.json()).then(d => setHealth(JSON.stringify(d))).catch(() => setHealth("server unreachable"));
  }, []);
  return <pre style={{ padding: 24 }}>Smart Interview AI{"\n"}{health}</pre>;
}
