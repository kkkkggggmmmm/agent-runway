import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "agent-runway:pwa-install-dismissed:v1";

const isStandalone = (): boolean =>
  window.matchMedia?.("(display-mode: standalone)").matches === true
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const mobilePlatform = (): "ios" | "android" | "other" => {
  const userAgent = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
};

const isMobileViewport = (): boolean =>
  mobilePlatform() !== "other" || (navigator.maxTouchPoints > 1 && window.innerWidth < 1_024);

export const usePwaInstall = () => {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === "1");
  const [installed, setInstalled] = useState(isStandalone);
  const platform = mobilePlatform();

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPromptEvent(null);
  }, [promptEvent]);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }, []);

  return {
    visible: isMobileViewport() && !installed && !dismissed,
    platform,
    canPrompt: promptEvent !== null,
    install,
    dismiss,
  };
};
