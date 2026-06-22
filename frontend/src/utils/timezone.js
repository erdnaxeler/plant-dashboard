// Timezone helpers ported verbatim (logic-wise) from the original dashboard.
// preferred_watering_hour_utc is stored in UTC; the UI shows/accepts a local
// time in the configured IANA timezone. These conversions are DST-correct and
// handle fractional offsets (e.g. Asia/Kolkata, UTC+5:30) via Intl.

export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Dubai',
  'Australia/Sydney',
];

// Convert a local "HH:MM" (in `timezone`) to a UTC hour 0-23 for today.
export function localTimeToUTCHour(hours, minutes, timezone) {
  minutes = minutes || 0;
  const now = new Date();

  const guessUtc = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    hours, minutes, 0
  ));

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  const map = {};
  for (const p of dtf.formatToParts(guessUtc)) map[p.type] = p.value;
  let localHour = parseInt(map.hour, 10);
  if (localHour === 24) localHour = 0;

  const localAsUtcMs = Date.UTC(
    parseInt(map.year, 10), parseInt(map.month, 10) - 1, parseInt(map.day, 10),
    localHour, parseInt(map.minute, 10)
  );
  const offsetMinutes = (localAsUtcMs - guessUtc.getTime()) / 60000;

  let totalMinutes = hours * 60 + minutes - offsetMinutes;
  totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  return Math.floor(totalMinutes / 60);
}

// Convert a stored UTC hour to a local "HH:MM" string in `timezone`.
export function utcHourToLocalTime(utcHour, timezone) {
  if (utcHour === null || utcHour === undefined) return '';
  if (!timezone) timezone = 'UTC';
  const now = new Date();
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, 0));
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(utcDate);
  } catch (e) {
    return `${String(utcDate.getHours()).padStart(2, '0')}:00`;
  }
}
