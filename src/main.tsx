import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { consumeMobileAccessToken } from "./lib/mobile";
import { registerServiceWorker } from "./registerServiceWorker";
import "./styles.css";

consumeMobileAccessToken();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
