import { isTauri } from "@tauri-apps/api/core";

export const registerServiceWorker = (): void => {
  if (isTauri() || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }, { once: true });
};
