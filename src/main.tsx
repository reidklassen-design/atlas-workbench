import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@/ipc/transport";
import { App } from "@/ui/App";
import "./index.css";

function reportFrontendCrash(title: string, message: string): void {
  void invoke("error.log", {
    error: {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      scope: "frontend-runtime",
      title,
      message,
      fix: "Restart Atlas Workbench. If this repeats, inspect ~/.config/atlas-workbench/logs/error.log.",
      ts: Date.now(),
    },
  }).catch(() => undefined);
}

window.addEventListener("error", (event) => {
  reportFrontendCrash("Frontend error", `${event.message}\n${event.filename}:${event.lineno}:${event.colno}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? `${event.reason.message}\n${event.reason.stack ?? ""}` : String(event.reason);
  reportFrontendCrash("Unhandled frontend promise rejection", reason);
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root was not found in index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
