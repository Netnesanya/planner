import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCalendar } from "../src/app/integrations/ical-parser";
import {
  applyImport,
  exportCalendar,
  previewImport,
} from "../src/app/integrations/calendar-transfer";
import { wallInstant } from "../src/app/integrations/calendar-time";
import { makeTask } from "../src/app/models";
const range = { from: "2026-10-01", to: "2026-11-30", zone: "Europe/Belgrade" };
const calendar = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tests//EN",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
const event = (body: string) => `BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT`;
const single = (extra = "") =>
  event(
    `UID:one@example.com\r\nDTSTART:20261114T090000Z\r\nDTEND:20261114T100000Z\r\nSUMMARY:Тренировка\r\n${extra}`,
  );

test("ICS export/import preserves Unicode, escaped descriptions, UTC times and all-day dates", () => {
  const timed = {
    ...makeTask("list", "local", "2026-11-14"),
    title: "Жим, спина; " + "Тренировка ".repeat(20),
    notes: "Первая строка\nВторая; запятая, обратная \\ черта",
    start_time: "10:00",
    duration: 90,
  };
  const day = {
    ...makeTask("list", "local", "2026-11-15"),
    title: "Цель",
    is_milestone: true,
  };
  const exported = exportCalendar([timed, day], {
    ...range,
    listIds: ["list"],
    completed: false,
    milestones: true,
  });
  assert.equal(exported.count, 2);
  for (const line of exported.text.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
  const imported = parseCalendar(exported.text, range);
  assert.equal(imported.issues.length, 0);
  assert.equal(imported.entries[0].title, timed.title);
  assert.equal(imported.entries[0].notes, timed.notes);
  assert.equal(imported.entries[0].time, "10:00");
  assert.equal(imported.entries[0].duration, 90);
  assert.equal(imported.entries[1].date, "2026-11-15");
  assert.equal(imported.entries[1].time, null);
  assert.equal(
    previewImport(imported.entries, [timed, day], "list").every(
      (r) => r.kind === "same",
    ),
    true,
  );
});

test("ICS import recognizes repeated files, requires opt-in updates and preserves task progress", () => {
  const entries = parseCalendar(calendar(single()), range).entries;
  const rows = previewImport(entries, [], "list");
  const tasks = applyImport(rows, [], "list", "local");
  assert.equal(tasks.length, 1);
  assert.equal(previewImport(entries, tasks, "list")[0].kind, "same");
  tasks[0].progress_mode = "manual";
  tasks[0].progress_value = 70;
  tasks[0].priority = 5;
  const changed = [{ ...entries[0], time: "11:00", title: "Новая тренировка" }];
  const updates = previewImport(changed, tasks, "list");
  assert.equal(updates[0].kind, "update");
  assert.equal(updates[0].selected, false);
  updates[0].selected = true;
  const updated = applyImport(updates, tasks, "list", "local");
  assert.equal(updated[0].id, tasks[0].id);
  assert.equal(updated[0].progress_value, 70);
  assert.equal(updated[0].priority, 5);
  assert.throws(
    () =>
      applyImport(
        updates,
        [{ ...tasks[0], notes: "Changed after preview" }],
        "list",
        "local",
      ),
    /изменились/,
  );
  assert.equal(previewImport(entries, tasks, "different-list")[0].kind, "new");
});

test("Google-style IANA timezone recurrence handles DST, UTC exclusion and moved/cancelled instances", () => {
  const master = event(
    "UID:series\r\nDTSTART;TZID=Europe/Belgrade:20261023T100000\r\nDTEND;TZID=Europe/Belgrade:20261023T110000\r\nRRULE:FREQ=DAILY;COUNT=5\r\nEXDATE:20261024T080000Z\r\nSUMMARY:Daily",
  );
  const moved = event(
    "UID:series\r\nRECURRENCE-ID;TZID=Europe/Belgrade:20261025T100000\r\nDTSTART;TZID=Europe/Belgrade:20261025T130000\r\nDTEND;TZID=Europe/Belgrade:20261025T140000\r\nSUMMARY:Moved",
  );
  const cancelled = event(
    "UID:series\r\nRECURRENCE-ID;TZID=Europe/Belgrade:20261026T100000\r\nSTATUS:CANCELLED",
  );
  const result = parseCalendar(calendar(master, moved, cancelled), range);
  assert.deepEqual(
    result.entries.map((e) => [e.date, e.time]),
    [
      ["2026-10-23", "10:00"],
      ["2026-10-25", "13:00"],
      ["2026-10-27", "10:00"],
    ],
    JSON.stringify(result),
  );
  assert.ok(result.issues.some((i) => i.reason.includes("Отменённое")));
  assert.equal(result.entries[1].recurrenceId, "2026-10-25T09:00:00.000Z");
});

test("Apple-style VTIMEZONE and folded text are parsed without using the machine timezone", () => {
  const tz =
    "BEGIN:VTIMEZONE\r\nTZID:Custom/Fixed\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0300\r\nTZOFFSETTO:+0300\r\nEND:STANDARD\r\nEND:VTIMEZONE";
  const result = parseCalendar(
    calendar(
      tz,
      event(
        "UID:apple\r\nDTSTART;TZID=Custom/Fixed:20261114T120000\r\nDTEND;TZID=Custom/Fixed:20261114T130000\r\nSUMMARY:Длинное\r\n  название",
      ),
    ),
    range,
  );
  assert.equal(result.entries[0].time, "10:00");
  assert.equal(result.entries[0].title, "Длинное название");
});

test("unsupported dates and cancelled events are reported without silently changing them", () => {
  const result = parseCalendar(
    calendar(
      event(
        "UID:multi\r\nDTSTART;VALUE=DATE:20261114\r\nDTEND;VALUE=DATE:20261117\r\nSUMMARY:Trip",
      ),
      event(
        "UID:unknown\r\nDTSTART;TZID=Imaginary/Zone:20261114T120000\r\nDTEND;TZID=Imaginary/Zone:20261114T130000",
      ),
      single("STATUS:CANCELLED"),
      event("UID:zero\r\nDTSTART:20261114T120000Z"),
    ),
    range,
  );
  assert.equal(result.entries.length, 0);
  assert.equal(result.issues.length, 4);
  assert.throws(() => parseCalendar("invalid", range));
  assert.throws(
    () => wallInstant("2026-03-29", "02:30", "Europe/Belgrade"),
    /отсутствует/,
  );
  assert.equal(
    new Date(
      wallInstant("2026-10-25", "02:30", "Europe/Belgrade"),
    ).toISOString(),
    "2026-10-25T00:30:00.000Z",
  );
});

test("monthly rules, detached exceptions and RDATE are finite and have stable occurrence identities", () => {
  const source = calendar(
    event(
      "UID:monthly\r\nDTSTART:20261001T080000Z\r\nDTEND:20261001T090000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=1TH;COUNT=4\r\nRDATE:20261110T080000Z\r\nSUMMARY:Monthly",
    ),
    event(
      "UID:detached\r\nRECURRENCE-ID:20260901T080000Z\r\nDTSTART:20261101T080000Z\r\nDTEND:20261101T090000Z\r\nSUMMARY:Moved into range",
    ),
  );
  const a = parseCalendar(source, range),
    b = parseCalendar(source, range);
  assert.deepEqual(a, b);
  assert.equal(a.entries.length, 4);
  assert.equal(a.issues.length, 0);
  assert.equal(
    a.entries.every((e) => !!e.recurrenceId),
    true,
  );
});

test("export filters lists, dates, completion and milestones without introducing new recurrence rules", () => {
  const base = { ...makeTask("one", "local", "2026-11-14"), title: "Task" };
  const tasks = [
    base,
    { ...base, id: "done", status: "done" as const },
    { ...base, id: "goal", is_milestone: true },
    { ...base, id: "other", list_id: "two" },
    { ...base, id: "undated", due_date: null },
    { ...base, id: "outside", due_date: "2027-01-01" },
  ];
  const options = {
    ...range,
    listIds: ["one"],
    completed: false,
    milestones: false,
  };
  const result = exportCalendar(tasks, options, 0);
  assert.equal(result.count, 1);
  assert.equal(result.issues.length, 1);
  assert.ok(!result.text.includes("RRULE"));
  assert.equal(exportCalendar(tasks, options, 0).text, result.text);
});
