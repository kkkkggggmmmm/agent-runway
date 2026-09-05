/// <reference types="vite/client" />

interface Window {
  __AGENT_RUNWAY_RUNTIME__?: {
    mode: "cloud-broker" | "static";
  };
}
