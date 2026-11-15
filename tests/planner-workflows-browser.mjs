import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.FLOW_TEST_URL || "http://127.0.0.1:4200");
  const seed = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("flow.planner.v1"));
    const base = d.tasks[0];
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const key = (v) =>
      `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    const today = key(day);
    day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    const start = key(day);
    const make = (title, extra = {}) => ({
      ...base,
      id: crypto.randomUUID(),
      title,
      notes: "",
      status: "todo",
      completed_at: null,
      is_milestone: false,
      goal_id: null,
      due_date: today,
      start_time: null,
      recurrence: "none",
      series_id: null,
      series_date: null,
      series_until: null,
      series_skips: [],
      source_task_id: null,
      tags: [],
      subtasks: [],
      duration: 60,
      ...extra,
    });
    const goal = make("Weekly goal", {
      is_milestone: true,
      progress_mode: "target",
      progress_value: 3500,
      progress_target: 5000,
      progress_unit: "USD",
    });
    const a = make("Backlog A", { due_date: null, goal_id: goal.id }),
      b = make("Backlog B", { due_date: null }),
      c = make("Weekly action", { goal_id: goal.id });
    d.tasks = [goal, a, b, c];
    d.cycles = [
      {
        id: crypto.randomUUID(),
        owner_id: "local",
        name: "Workflow cycle",
        start_date: start,
        vision: "",
        goal_ids: [goal.id],
        reviews: {},
        archived: false,
      },
    ];
    localStorage.setItem("flow.planner.v1", JSON.stringify(d));
    return { today, a: a.id, b: b.id, goal: goal.id };
  });
  await page.reload();
  const data = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("flow.planner.v1")));
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await expect(page.locator("app-calendar-backlog")).toBeVisible();
  await page
    .getByRole("button", { name: "Запланировать: Backlog A", exact: true })
    .click();
  await page.getByLabel("Время планирования", { exact: true }).fill("10:00");
  await page
    .getByRole("button", { name: "Запланировать", exact: true })
    .click();
  expect((await data()).tasks.find((t) => t.id === seed.a).start_time).toBe(
    "10:00",
  );
  // Pointer drag an undated item into the same day at 11:00.
  const drag = page.locator(`[data-backlog-id="${seed.b}"] .backlog-drag`);
  const slot = page.getByRole("button", {
    name: `Добавить задачу ${seed.today} в 11:00`,
    exact: true,
  });
  await slot.scrollIntoViewIfNeeded();
  const rect = await drag.boundingBox(),
    target = await slot.boundingBox();
  await page.mouse.move(rect.x + 20, rect.y + 8);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 8, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () => (await data()).tasks.find((t) => t.id === seed.b).start_time,
    )
    .toBe("11:00");
  await expect(
    page.locator(".day-load").filter({ hasText: "3 ч" }),
  ).toHaveCount(1);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/week-planning-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Все задачи", exact: false })
    .first()
    .click();
  await page.getByRole("tab", { name: "Список", exact: true }).click();
  await page
    .getByRole("button", { name: "Выбрать задачи", exact: true })
    .click();
  await page.getByLabel("Выбрать: Backlog A", { exact: true }).check();
  await page.getByLabel("Выбрать: Backlog B", { exact: true }).check();
  await page.getByLabel("Действие", { exact: true }).selectOption("tag");
  await page.getByLabel("Новый тег", { exact: true }).fill("batch");
  await page
    .getByRole("button", { name: "Применить к 2", exact: true })
    .click();
  expect(
    (await data()).tasks.filter((t) => t.tags.includes("batch")),
  ).toHaveLength(2);
  await page.getByRole("button", { name: "Вернуть", exact: true }).click();
  expect(
    (await data()).tasks.filter((t) => t.tags.includes("batch")),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "12 недель", exact: true }).click();
  const goal = page.locator("app-goal-week");
  await expect(goal).toContainText("70%");
  await expect(goal).toContainText("0 / 2");
  await goal
    .getByRole("button", { name: "Показать действия", exact: true })
    .click();
  await expect(
    goal.getByRole("button", { name: /Weekly action/ }),
  ).toBeVisible();
  await goal
    .getByRole("button", { name: "Добавить действие", exact: true })
    .click();
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Linked from goal");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  expect(
    (await data()).tasks.find((t) => t.title === "Linked from goal").goal_id,
  ).toBe(seed.goal);
  await expect(goal).toContainText("0 / 3");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/goal-week-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Планнер", exact: true }).click();
  await page.getByRole("tab", { name: "Календарь", exact: true }).click();
  await expect(page.locator("app-calendar-backlog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/week-planning-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS weekly backlog pointer/keyboard scheduling, load, bulk undo, goal actions and mobile layout",
  );
} finally {
  await browser.close();
}
