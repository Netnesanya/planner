import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  locale: "ru-RU",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const data = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("flow.planner.v1")));
const task = async (title) =>
  (await data()).tasks.find((t) => t.title === title);
const save = () =>
  page.getByRole("button", { name: "Сохранить", exact: true }).click();
try {
  await page.goto(process.env.FLOW_TEST_URL || "http://127.0.0.1:4200");
  const ids = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("flow.planner.v1"));
    const now = new Date();
    const today =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const base = {
      ...d.tasks[0],
      status: "todo",
      completed_at: null,
      recurrence: "none",
      series_id: null,
      series_date: null,
      series_until: null,
      series_skips: [],
      source_task_id: null,
      goal_id: null,
      tags: [],
      subtasks: [],
      notes: "",
      due_date: today,
      duration: 45,
    };
    const timed = {
      ...base,
      id: crypto.randomUUID(),
      title: "Pointer test",
      start_time: "09:00",
    };
    const noDate = {
      ...base,
      id: crypto.randomUUID(),
      title: "Undated test",
      start_time: null,
      due_date: null,
    };
    const goal = {
      ...base,
      id: crypto.randomUUID(),
      title: "Distinct goal",
      is_milestone: true,
      start_time: null,
    };
    const linked = {
      ...base,
      id: crypto.randomUUID(),
      title: "Linked action",
      start_time: null,
      goal_id: goal.id,
    };
    const done = {
      ...base,
      id: crypto.randomUUID(),
      title: "Finished-only search",
      start_time: null,
      status: "done",
      completed_at: new Date().toISOString(),
    };
    const night = {
      ...base,
      id: crypto.randomUUID(),
      title: "Midnight boundary",
      start_time: "23:45",
      duration: 15,
    };
    d.tasks = [timed, noDate, goal, linked, done, night];
    localStorage.setItem("flow.planner.v1", JSON.stringify(d));
    return { timed: timed.id, night: night.id, today };
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Новая задача", exact: false })
    .click();
  await expect(
    page.getByLabel("Название задачи", { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Protected draft");
  await page.keyboard.press("Escape");
  const discard = page.getByRole("dialog", {
    name: "Сохранить изменения?",
    exact: true,
  });
  await expect(discard).toBeVisible();
  await expect(
    discard.getByRole("button", { name: "Продолжить редактирование" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(discard).toHaveCount(0);
  await expect(page.getByLabel("Название задачи", { exact: true })).toHaveValue(
    "Protected draft",
  );
  await page.getByPlaceholder("Добавить подзадачу").fill("Pending step");
  await page.locator("textarea[name=notes]").focus();
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("app-task-editor")).toHaveCount(0);
  expect((await task("Protected draft")).subtasks[0].title).toBe(
    "Pending step",
  );
  console.log(
    "PASS unsaved guard, Escape hierarchy, initial focus, keyboard save and pending subtask",
  );
  await page
    .getByRole("button", { name: "Все задачи", exact: false })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Добавить задачу: Без даты", exact: true })
    .click();
  await expect(page.getByLabel("Дата задачи", { exact: true })).toHaveValue("");
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Without date");
  await save();
  expect((await task("Without date")).due_date).toBeNull();
  await page.locator("#global-search").fill("Distinct goal");
  await expect(
    page.locator(".task-title").filter({ hasText: "Linked action" }),
  ).toBeVisible();
  await page.locator("#global-search").fill("Finished-only search");
  await expect(page.locator(".empty-state")).toHaveCount(0);
  await expect(
    page.locator(".task-title").filter({ hasText: "Finished-only search" }),
  ).toBeVisible();
  await page.locator("#global-search").fill("");
  console.log(
    "PASS undated creation, goal-linked search and completed search state",
  );
  await page
    .getByRole("button", { name: "Новая задача", exact: false })
    .click();
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Save failure draft");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "flow.planner.v1")
        throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await save();
  await expect(page.locator(".editor-error")).toContainText("Storage full");
  await expect(page.getByLabel("Название задачи", { exact: true })).toHaveValue(
    "Save failure draft",
  );
  expect(await task("Save failure draft")).toBeUndefined();
  await page.evaluate(() => window.restoreStorage());
  await save();
  await expect(page.locator("app-task-editor")).toHaveCount(0);
  console.log("PASS failed save preserves editor draft and retry persists it");
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  const body = page.locator(
    `.calendar-event[data-task-id="${ids.timed}"] .event-body`,
  );
  await body.scrollIntoViewIfNeeded();
  let rect = await body.boundingBox();
  const target = page.locator(`[data-all-day-date="${ids.today}"]`);
  const dest = await target.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(dest.x + dest.width / 2, dest.y + 8, { steps: 10 });
  await expect(page.locator(".all-day-preview")).toBeVisible();
  await page.mouse.up();
  await expect
    .poll(async () => (await task("Pointer test")).start_time)
    .toBeNull();
  const allDay = page.locator(`.all-day-task[data-task-id="${ids.timed}"]`);
  rect = await allDay.boundingBox();
  const hour = page.getByRole("button", {
    name: `Добавить задачу ${ids.today} в 10:00`,
    exact: true,
  });
  const slot = await hour.boundingBox();
  await page.mouse.move(rect.x + 10, rect.y + 6);
  await page.mouse.down();
  await page.mouse.move(slot.x + slot.width / 2, slot.y + 6, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await task("Pointer test")).start_time)
    .toBe("10:00");
  await body.scrollIntoViewIfNeeded();
  rect = await body.boundingBox();
  await page.mouse.move(rect.x + 10, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(20, 20, { steps: 10 });
  await page.mouse.up();
  expect((await task("Pointer test")).start_time).toBe("10:00");
  const resize = page.locator(
    `.calendar-event[data-task-id="${ids.night}"] .event-resize`,
  );
  await resize.focus();
  await page.keyboard.press("ArrowDown");
  expect((await task("Midnight boundary")).duration).toBe(15);
  console.log(
    "PASS timed/all-day pointer transfers, outside drop cancellation and midnight resize limit",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Новая задача", exact: false })
    .click();
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Mobile draft");
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  await expect(discard).toBeVisible();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/planner-unsaved-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await discard
    .getByRole("button", { name: "Не сохранять", exact: true })
    .click();
  await expect(page.locator("app-task-editor")).toHaveCount(0);
  expect(await task("Mobile draft")).toBeUndefined();
  expect(errors).toEqual([]);
  console.log("PASS mobile discard dialog and no runtime errors");
} finally {
  await browser.close();
}
