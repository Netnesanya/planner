import ICAL from "ical.js";
import {
  CalendarEntry,
  CalendarPreview,
  CalendarRange,
  entryKey,
  MAX_CALENDAR_BYTES,
  MAX_CALENDAR_EVENTS,
} from "./calendar-transfer";
import { validateRange, wallInstant, zonedParts } from "./calendar-time";
type Time = InstanceType<typeof ICAL.Time>;
type Component = InstanceType<typeof ICAL.Component>;
const text = (component: Component, key: string) =>
  String(component.getFirstPropertyValue(key) || "");
function instant(
  time: Time,
  component: Component,
  property: string,
  zone: string,
) {
  if (time.second !== 0)
    throw new Error("Время с секундами пока не поддерживается.");
  if (time.zone.tzid === "UTC" || time.zone.component)
    return time.toUnixTime() * 1000;
  const tzid = component.getFirstProperty(property)?.getParameter("tzid");
  return wallInstant(
    time.toString().slice(0, 10),
    time.toString().slice(11, 16),
    String(tzid || zone),
  );
}
function recurrenceKey(
  time: Time,
  component: Component,
  property: string,
  zone: string,
) {
  return time.isDate
    ? time.toString()
    : new Date(instant(time, component, property, zone)).toISOString();
}
export function parseCalendar(
  raw: string,
  range: CalendarRange,
): CalendarPreview {
  validateRange(range.from, range.to, range.zone);
  if (new TextEncoder().encode(raw).length > MAX_CALENDAR_BYTES)
    throw new Error("Файл больше 2 МБ. Экспортируйте меньший календарь.");
  ICAL.TimezoneService.reset();
  const root = new ICAL.Component(ICAL.parse(raw.replace(/^\uFEFF/, "")));
  if (root.name !== "vcalendar")
    throw new Error("Ожидается календарный файл .ics.");
  const components = root.getAllSubcomponents("vevent");
  if (!components.length) throw new Error("В файле нет событий VEVENT.");
  if (components.length > MAX_CALENDAR_EVENTS)
    throw new Error("В файле больше 2000 событий. Выберите меньший файл.");
  for (const component of root.getAllSubcomponents("vtimezone")) {
    const zone = new ICAL.Timezone(component);
    ICAL.TimezoneService.register(zone.tzid, zone);
  }
  // Google files may use an IANA TZID without embedding VTIMEZONE.
  // Supply ICAL's comparisons (including UTC EXDATE) with the browser's zone data.
  for (const component of components)
    for (const property of component.getAllProperties()) {
      const tzid = property.getParameter("tzid");
      if (typeof tzid !== "string" || ICAL.TimezoneService.has(tzid)) continue;
      try {
        zonedParts(Date.now(), tzid);
        const zone = new ICAL.Timezone({ tzid });
        zone.utcOffset = (time: Time) => {
          const date = `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
          const clock = `${String(time.hour || 0).padStart(2, "0")}:${String(time.minute || 0).padStart(2, "0")}`;
          return (
            (Date.parse(`${date}T${clock}:00Z`) -
              wallInstant(date, clock, tzid)) /
            1000
          );
        };
        ICAL.TimezoneService.register(tzid, zone);
      } catch {
        /* Unknown TZIDs are reported per event, never assumed local. */
      }
    }
  const result: CalendarPreview = { entries: [], issues: [], outside: 0 };
  const entries = new Map<string, CalendarEntry>();
  const groups = new Map<string, Component[]>();
  for (const component of components) {
    const uid = text(component, "uid");
    if (!uid || uid.length > 1024) {
      result.issues.push({
        title: text(component, "summary") || "Без названия",
        reason: "Отсутствует или слишком длинный UID.",
      });
      continue;
    }
    const group = groups.get(uid) || [];
    if (
      !group.some(
        (c) =>
          JSON.stringify(c.toJSON()) === JSON.stringify(component.toJSON()),
      )
    )
      group.push(component);
    groups.set(uid, group);
  }
  let steps = 0;
  for (const [uid, group] of groups) {
    const title = text(group[0], "summary") || "Без названия";
    const groupEntries: CalendarEntry[] = [];
    const emit = (
      component: Component,
      start: Time,
      end: Time,
      recurrenceId: string,
    ) => {
      if (
        text(component, "status").toUpperCase() === "CANCELLED" ||
        text(root, "method").toUpperCase() === "CANCEL"
      ) {
        result.issues.push({
          title: text(component, "summary") || title,
          reason:
            "Отменённое событие пропущено. Существующая задача не удаляется.",
        });
        return;
      }
      let date: string,
        time: string | null = null,
        duration = 30;
      if (start.isDate) {
        date = start.toString();
        if (!end.isDate || end.subtractDate(start).toSeconds() !== 86400)
          throw new Error("Многодневное событие пока не поддерживается.");
      } else {
        const startMs = instant(start, component, "dtstart", range.zone);
        const endMs = instant(
          end,
          component,
          component.hasProperty("dtend") ? "dtend" : "dtstart",
          range.zone,
        );
        const local = zonedParts(startMs, range.zone);
        date = local.date;
        time = local.time;
        duration = (endMs - startMs) / 60000;
        if (!Number.isInteger(duration) || duration < 5 || duration > 1440)
          throw new Error(
            "Нужна длительность от 5 до 1440 минут; события без длительности пропускаются.",
          );
        if (zonedParts(endMs - 1, range.zone).date !== date)
          throw new Error(
            "События с переходом через полночь пока не поддерживаются.",
          );
      }
      if (date < range.from || date > range.to) {
        result.outside++;
        return;
      }
      const entry: CalendarEntry = {
        uid,
        recurrenceId,
        title: text(component, "summary") || title,
        notes: text(component, "description"),
        date,
        time,
        duration,
      };
      if (entry.title.length > 500 || entry.notes.length > 20000)
        throw new Error("Название или описание превышает допустимую длину.");
      groupEntries.push(entry);
      if (entries.size + groupEntries.length > MAX_CALENDAR_EVENTS)
        throw new Error("В диапазоне больше 2000 событий. Сократите диапазон.");
    };
    try {
      const masters = group.filter((c) => !c.hasProperty("recurrence-id"));
      const exceptions = group.filter((c) => c.hasProperty("recurrence-id"));
      if (masters.length > 1)
        throw new Error(
          "Несколько разных событий с одним UID — требуется устранить конфликт в исходном календаре.",
        );
      if (
        exceptions.some((c) =>
          c.getFirstProperty("recurrence-id")?.getParameter("range"),
        )
      )
        throw new Error(
          "Изменение «этого и всех следующих» событий пока не поддерживается.",
        );
      const exceptionIds = exceptions.map((c) =>
        recurrenceKey(
          c.getFirstPropertyValue("recurrence-id") as Time,
          c,
          "recurrence-id",
          range.zone,
        ),
      );
      if (new Set(exceptionIds).size !== exceptionIds.length)
        throw new Error("Несколько версий одного повторения.");
      if (masters.length) {
        const component = masters[0];
        const event = new ICAL.Event(component, { exceptions: [] });
        if (text(component, "status").toUpperCase() === "CANCELLED") {
          result.issues.push({
            title,
            reason:
              "Отменённая серия пропущена. Существующие задачи не удаляются.",
          });
          continue;
        }
        if (!component.hasProperty("dtstart"))
          throw new Error("Нет даты начала.");
        if (
          component.getAllProperties("rdate").some((p) => p.type === "period")
        )
          throw new Error(
            "Повторения RDATE с отдельной длительностью пока не поддерживаются.",
          );
        if (component.hasProperty("exrule"))
          throw new Error("Устаревшее правило EXRULE пока не поддерживается.");
        if (event.isRecurring()) {
          for (const rule of component.getAllProperties("rrule")) {
            const value = rule.getFirstValue() as InstanceType<
              typeof ICAL.Recur
            >;
            if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value.freq))
              throw new Error(
                "Повторения чаще одного раза в день пока не поддерживаются.",
              );
          }
          const iterator = event.iterator();
          let next: Time | undefined;
          while ((next = iterator.next())) {
            if (++steps > 50000)
              throw new Error(
                "Слишком длинная серия повторений. Экспортируйте меньший диапазон.",
              );
            // Two-day cushion covers timezone conversion at the range boundary.
            if (
              next.toString().slice(0, 10) >
              new Date(Date.parse(range.to) + 2 * 86400000)
                .toISOString()
                .slice(0, 10)
            )
              break;
            const key = recurrenceKey(next, component, "dtstart", range.zone);
            if (exceptionIds.includes(key)) continue;
            const occurrence = event.getOccurrenceDetails(next);
            emit(component, occurrence.startDate, occurrence.endDate, key);
          }
        } else emit(component, event.startDate, event.endDate, "");
      }
      // Process detached/moved exceptions separately, including those moved into the range.
      exceptions.forEach((component, index) => {
        if (text(component, "status").toUpperCase() === "CANCELLED") {
          result.issues.push({
            title: text(component, "summary") || title,
            reason:
              "Отменённое повторение пропущено. Существующая задача не удаляется.",
          });
          return;
        }
        const event = new ICAL.Event(component, { exceptions: [] });
        emit(component, event.startDate, event.endDate, exceptionIds[index]);
      });
      for (const entry of groupEntries) entries.set(entryKey(entry), entry);
    } catch (error) {
      result.issues.push({
        title,
        reason: (error as Error).message || "Не удалось прочитать событие.",
      });
    }
  }
  result.entries = [...entries.values()].sort((a, b) =>
    `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`),
  );
  return result;
}
