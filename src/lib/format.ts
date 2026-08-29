export const formatPercent = (value: number, digits = 0): string =>
  `${value.toFixed(digits)}%`;

export const formatDateTime = (epochSeconds: number): string =>
  new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epochSeconds * 1_000));

export const formatTime = (epochMs: number): string =>
  new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epochMs));

export const formatRelativeAge = (epochMs: number, nowMs = Date.now()): string => {
  const seconds = Math.max(Math.round((nowMs - epochMs) / 1_000), 0);
  if (seconds < 15) return "たった今";
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分前`;
  return `${Math.floor(minutes / 60)}時間前`;
};

export const formatRemainingDuration = (milliseconds: number): string => {
  const totalMinutes = Math.max(Math.round(milliseconds / 60_000), 0);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}日${hours}時間`;
  if (hours > 0) return `${hours}時間${minutes}分`;
  return `${minutes}分`;
};

export const formatPace = (paceDays: number): { value: string; label: string } => {
  const magnitude = Math.abs(paceDays).toFixed(1);
  if (Math.abs(paceDays) < 0.05) return { value: "±0.0日", label: "予定どおり" };
  return paceDays > 0
    ? { value: `+${magnitude}日`, label: "先行消費" }
    : { value: `−${magnitude}日`, label: "余裕" };
};

export const confidenceLabel = (confidence: "low" | "medium" | "high"): string => ({
  low: "低信頼",
  medium: "中信頼",
  high: "高信頼",
})[confidence];
