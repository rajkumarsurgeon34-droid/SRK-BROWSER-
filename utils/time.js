// Parses user-entered times into a future Date.
// Accepts: "5:00 PM", "5pm", "17:30", "in 10 min", "in 2 hours", "in 30 s".
// A clock time that has already passed today is scheduled for tomorrow.
export function parseTime(input, now = new Date()) {
  const s = String(input).trim().toLowerCase();

  const rel = s.match(/^in\s+(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2][0];
    const ms = unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000;
    return new Date(now.getTime() + n * ms);
  }

  const clock = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!clock) return null;

  let hours = parseInt(clock[1], 10);
  const minutes = clock[2] ? parseInt(clock[2], 10) : 0;
  const meridiem = clock[3] ? clock[3][0] : null;

  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'p' && hours !== 12) hours += 12;
    if (meridiem === 'a' && hours === 12) hours = 0;
  } else if (hours > 23 || !clock[2]) {
    // A bare number like "5" is ambiguous; require "5pm" or "17:00".
    return null;
  }

  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  if (date <= now) date.setDate(date.getDate() + 1);
  return date;
}

export function formatWhen(iso) {
  if (!iso) return 'Anytime';
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString()} ${time}`;
}
