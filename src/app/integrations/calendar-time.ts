/** Calendar wall times are interpreted in an explicit IANA zone, never the machine's zone. */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function zonedParts(instant: number, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, formatter);
  }
  const p = Object.fromEntries(
    formatter.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return {
    date: `${p["year"]}-${p["month"]}-${p["day"]}`,
    time: `${p["hour"]}:${p["minute"]}`,
    second: Number(p["second"]),
  };
}
export function wallInstant(date: string, time: string, zone: string): number {
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall)) throw new Error("Некорректные дата или время.");
  const offsets = new Set<number>();
  for (let h = -36; h <= 36; h += 6) {
    const sample = wall + h * 3600000;
    const p = zonedParts(sample, zone);
    offsets.add(
      Date.parse(`${p.date}T${p.time}:${String(p.second).padStart(2, "0")}Z`) -
        sample,
    );
  }
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((value) => {
      const p = zonedParts(value, zone);
      return p.date === date && p.time === time;
    })
    .sort((a, b) => a - b);
  if (!matches.length)
    throw new Error("Это время отсутствует при переходе на летнее время.");
  // RFC 5545: the first occurrence is used for an ambiguous wall clock time.
  return matches[0];
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function validateRange(from: string, to: string, zone: string) {
  if (
    !validDate(from) ||
    !validDate(to) ||
    to < from ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 365
  )
    throw new Error("Выберите диапазон от 1 до 366 дней.");
  zonedParts(Date.now(), zone);
}
