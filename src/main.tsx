import { createRoot } from "react-dom/client";
import "./index.css";

function fatal(message: string) {
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `
      <div class="fatal">
        <h1 style="font-size:20px;font-weight:800;color:#e4e4e7">WASM engine failed to load</h1>
        <p style="max-width:420px;color:#8b8b96;font-size:14px;line-height:1.6">${message}</p>
        <p style="color:#6b6b76;font-size:12px">Try a recent Chrome / Firefox / Edge, or check the console for details.</p>
      </div>`;
  }
}

async function boot() {
  try {
    const { App } = await import("./App");
    createRoot(document.getElementById("root")!).render(<App />);
  } catch (e) {
    fatal(
      e instanceof Error
        ? e.message
        : "The @chironbuilder/tari-l1-wasm module could not be initialised in this browser.",
    );
    console.error(e);
  }
}

void boot();
