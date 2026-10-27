// Database menyimpan UTC; tampilan, nomor transaksi, filter tanggal dan Excel
// memakai jam dinding zona aplikasi (default WIB).
export const appTimezone = () => process.env.APP_TIMEZONE || "Asia/Jakarta";
export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};
const pad = (value: number) => String(value).padStart(2, "0");
/** Jam dinding di zona aplikasi untuk satu titik waktu. */
export function wallClock(date: Date): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: appTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}
/** Tanggal "2026-10-26" menurut zona aplikasi. */
export function localDay(date = new Date()) {
  const w = wallClock(date);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}
/** Jam dinding zona aplikasi → titik waktu UTC. Offset dihitung lewat Intl (termasuk DST). */
export function zonedToUtc(w: WallClock) {
  const target = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second,
  );
  let utc = target;
  for (let n = 0; n < 3; n++) {
    const r = wallClock(new Date(utc));
    utc +=
      target - Date.UTC(r.year, r.month - 1, r.day, r.hour, r.minute, r.second);
  }
  return new Date(utc);
}
/** Nilai kolom DATETIME MySQL (UTC), mis. "2026-10-26 07:30:00". */
export function sqlDateTime(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
/** Kolom DATETIME MySQL (UTC, dateStrings) → Date. */
export function fromSqlDateTime(value: string) {
  return new Date(value.replace(" ", "T") + "Z");
}
