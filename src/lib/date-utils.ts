/**
 * Simple date formatting utility
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const padZero = (n: number): string => n.toString().padStart(2, "0");

export function format(timestamp: number | Date, pattern: string): string {
  const date = typeof timestamp === "number" ? new Date(timestamp) : timestamp;
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();

  return pattern
    .replace("yyyy", year.toString())
    .replace("yy", year.toString().slice(-2))
    .replace("MMM", MONTHS[month])
    .replace("MM", padZero(month + 1))
    .replace("dd", padZero(day))
    .replace("HH", padZero(hours))
    .replace("mm", padZero(minutes))
    .replace("ss", padZero(seconds));
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

export function formatDateRange(startTime: number, endTime: number): string {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const startStr = format(start, "HH:mm");
  const endStr = format(end, "HH:mm");

  const startDate = format(start, "MMM dd, yyyy");
  const endDate = format(end, "MMM dd, yyyy");

  if (startDate === endDate) {
    return `${startDate} ${startStr} - ${endStr}`;
  }
  return `${startDate} ${startStr} - ${endDate} ${endStr}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${hours}h`;
}
