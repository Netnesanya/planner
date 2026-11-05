import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const base = process.env.FLOW_TEST_URL || "http://127.0.0.1:4200";
await mkdir("test-results", { recursive: true });
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(base);
    if (response.ok) break;
    if (attempt === 29) throw new Error("Preview returned " + response.status);
  } catch (error) {
    if (attempt === 29) throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "ru-RU",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const data = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("flow.planner.v1")));
const taskByTitle = async (title) =>
  (await data()).tasks.find((t) => t.title === title);
try {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Сегодня.", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  console.log("PASS initial rendering");
  await page
    .getByRole("button", { name: "Новая задача", exact: false })
    .click();
  await page
    .getByRole("textbox", { name: "Название задачи" })
    .fill("Проверка всех возможностей");
  await page
    .getByRole("combobox", { name: "Длительность задачи", exact: true })
    .fill("1ч 30м");
  await page.getByLabel("Время начала").fill("10:00");
  await page.locator('select[name="recurrence"]').selectOption("daily");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Приоритет 5 из 5", exact: true })
    .click();
  await page.locator('input[name="tags"]').fill("проверка, фокус");
  await page
    .getByRole("combobox", { name: "Способ отслеживания прогресса" })
    .selectOption("target");
  await page.getByRole("spinbutton", { name: "Сделано по цели" }).fill("3500");
  await page.getByRole("spinbutton", { name: "Целевое значение" }).fill("5000");
  await page.getByRole("textbox", { name: "Единица прогресса" }).fill("$");

  await page.getByPlaceholder("Добавить подзадачу").fill("Первый шаг");
  await page.getByPlaceholder("Добавить подзадачу").press("Enter");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("app-task-editor")).toHaveCount(0);
  let task = await taskByTitle("Проверка всех возможностей");
  expect(task.duration).toBe(90);
  expect(task.priority).toBe(5);
  expect(task.subtasks).toHaveLength(1);
  const card = page.locator(`[data-task-id="${task.id}"]`);
  expect(task.progress_value).toBe(3500);
  expect(task.progress_target).toBe(5000);
  await expect(card.getByRole("slider")).toHaveValue("70");
  await card.getByTitle("Изменить выполненную часть").click();
  await card
    .getByRole("textbox", { name: "Выполненная часть цели" })
    .fill("4250");
  await card
    .getByRole("textbox", { name: "Выполненная часть цели" })
    .press("Enter");
  await expect
    .poll(async () => (await taskByTitle(task.title)).progress_value)
    .toBe(4250);
  await expect(card.getByRole("slider")).toHaveValue("85");
  console.log(
    "PASS task completion ratio: 3500/5000, then inline update to 4250",
  );

  await card
    .getByRole("button", { name: "Приоритет 2 из 5", exact: true })
    .click();
  expect((await taskByTitle(task.title)).priority).toBe(2);
  await card
    .getByRole("button", { name: "Приоритет 2 из 5", exact: true })
    .click();
  expect((await taskByTitle(task.title)).priority).toBe(0);
  await card
    .getByRole("button", { name: "Приоритет 5 из 5", exact: true })
    .click();
  const durationInput = card.getByRole("combobox", {
    name: "Длительность задачи " + task.title,
  });
  await durationInput.click();
  await page.getByRole("option", { name: "45 мин", exact: true }).click();
  await expect
    .poll(async () => (await taskByTitle(task.title)).duration)
    .toBe(45);
  await durationInput.fill("2:15");
  await durationInput.press("Enter");
  expect((await taskByTitle(task.title)).duration).toBe(135);
  expect((await taskByTitle(task.title)).priority).toBe(5);
  await durationInput.fill("ошибка");
  await durationInput.press("Enter");
  await expect(card.getByRole("alert")).toBeVisible();
  expect((await taskByTitle(task.title)).duration).toBe(135);
  await durationInput.fill("90");
  await durationInput.press("Enter");
  await page.reload();
  await expect(card).toBeVisible();
  expect((await taskByTitle(task.title)).duration).toBe(90);
  console.log("PASS create, inline duration, 0–5 stars and persistence");
  const first = page.locator(".task-group app-task-card").first();
  await card.dragTo(first);
  await expect
    .poll(
      async () =>
        JSON.parse(
          await page.evaluate(() => localStorage.getItem("flow.preferences")),
        ).sort,
    )
    .toBe("manual");
  await expect(
    page.locator(".task-group app-task-card").first().locator(".task-card"),
  ).toHaveAttribute("data-task-id", task.id);
  const work = (await data()).lists.find((l) => l.name === "Работа");
  await card.dragTo(
    page.locator(".list-nav-row").filter({ hasText: "Работа" }),
  );
  await expect
    .poll(async () => (await taskByTitle(task.title)).list_id)
    .toBe(work.id);
  console.log("PASS manual task order and drag into another list");

  await page.getByRole("tab", { name: "Канбан", exact: true }).click();
  await card.dragTo(page.locator(".kanban-column").nth(1));
  await expect
    .poll(async () => (await taskByTitle(task.title)).status)
    .toBe("doing");
  console.log("PASS kanban drag and drop");
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  const event = page.locator(`.calendar-event[data-task-id="${task.id}"]`);
  await expect(event).toBeVisible();
  const resize = event.getByRole("button", {
    name: "Изменить длительность перетаскиванием",
  });
  await resize.scrollIntoViewIfNeeded();
  const bounds = await resize.boundingBox();

  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2 + 64,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await taskByTitle(task.title)).duration)
    .toBe(150);
  console.log("PASS calendar pointer resize (+60 minutes)");
  await page.screenshot({ path: "test-results/calendar.png", fullPage: true });
  async function preciseMove(targetDate, time, grabOffset) {
    const body = event.locator(".event-body");
    await body.scrollIntoViewIfNeeded();
    const box = await body.boundingBox();
    const cell = page.getByRole("button", {
      name: `Добавить задачу ${targetDate} в ${Number(time.slice(0, 2))}:00`,
      exact: true,
    });
    const rect = await cell.boundingBox();
    const [h, m] = time.split(":").map(Number);
    await page.mouse.move(box.x + box.width / 2, box.y + grabOffset);
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width / 2,
      rect.y + (m / 60) * 64 + grabOffset,
      { steps: 8 },
    );
    await expect(page.locator(".move-time")).toContainText(time);
    await page.mouse.up();
    await expect
      .poll(async () => (await taskByTitle(task.title)).start_time)
      .toBe(time);
    await expect
      .poll(async () => (await taskByTitle(task.title)).due_date)
      .toBe(targetDate);
    await expect(page.locator("app-task-editor")).toHaveCount(0);
  }
  await preciseMove(task.due_date, "09:00", 70);
  await preciseMove(task.due_date, "11:15", 15);
  await preciseMove(task.due_date, "09:00", 100);
  const cancelBox = await event.locator(".event-body").boundingBox();
  await page.mouse.move(cancelBox.x + 12, cancelBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(cancelBox.x + 12, cancelBox.y + 52, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await taskByTitle(task.title)).start_time).toBe("09:00");
  console.log(
    "PASS calendar exact top-edge snapping with different grab offsets and Escape cancel",
  );
  await page.getByRole("button", { name: "Месяц", exact: true }).click();
  await expect(page.locator(".month-cell")).toHaveCount(42);
  await page.getByRole("button", { name: "Таймлайн", exact: true }).click();
  await expect(page.locator(".timeline-row").first()).toBeVisible();
  await expect(page.locator(".timeline-row")).toHaveCount(
    (await data()).lists.length,
  );
  await expect(page.locator(".milestone")).toHaveCount(0);
  await expect(page.locator(".timeline-resize")).toHaveCount(0);
  console.log("PASS timeline has one row per list and hides ordinary tasks");

  await page
    .getByRole("button", { name: "Сегодня", exact: false })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Выполнить: " + task.title, exact: true })
    .click();
  const completed = (await data()).tasks.find((t) => t.id === task.id);
  expect(completed.status).toBe("done");
  const next = (await data()).tasks
    .filter((t) => t.series_id === task.id && t.id !== task.id)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  expect(next.length).toBeGreaterThanOrEqual(82);
  expect(next[0].progress_value).toBe(0);
  expect(next[0].progress_target).toBe(5000);
  expect(completed.progress_value).toBe(4250);
  await page.getByRole("button", { name: "Выполненные", exact: true }).click();
  await expect(
    page.getByRole("button", { name: task.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Статистика", exact: true }).click();
  await expect(page.locator(".stats-kpis")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Период статистики" })
    .selectOption({ label: "Последние 30 дней" });
  await expect(page.locator(".bar-column")).toHaveCount(30);
  await page.screenshot({
    path: "test-results/statistics.png",
    fullPage: true,
  });
  console.log("PASS recurrence, completion history and statistics");
  await page.getByRole("button", { name: "Фокус", exact: true }).click();
  await page.getByRole("button", { name: "Начать фокус" }).click();
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "12 недель", exact: true }).click();
  await page.getByRole("button", { name: "Создать первый цикл" }).click();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Сильнее за 12 недель");
  await page
    .getByLabel("Зачем мне это?")
    .fill("Стать сильнее и тренироваться регулярно.");
  await page.getByRole("button", { name: "Начать 12 недель" }).click();
  await expect(page.locator(".week-strip button")).toHaveCount(12);
  await page.getByRole("button", { name: "Новая цель", exact: true }).click();
  await expect(page.getByRole("radio", { name: /Майлстоун/ })).toBeChecked();
  await expect(page.getByLabel("Время начала")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Длительность задачи", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Название задачи" })
    .fill("Пожать свой вес");
  const personalList = (await data()).lists.find((l) => l.name === "Личное");
  await page.locator('select[name="list"]').selectOption(personalList.id);
  await page
    .getByRole("button", { name: "Цвет тега #ef9a9a", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Способ отслеживания прогресса" })
    .selectOption("target");
  await page.getByRole("spinbutton", { name: "Сделано по цели" }).fill("70");
  await page.getByRole("spinbutton", { name: "Целевое значение" }).fill("90");
  await page.getByRole("textbox", { name: "Единица прогресса" }).fill("кг");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const goal = await taskByTitle("Пожать свой вес");
  expect(goal.is_milestone).toBe(true);
  await expect
    .poll(async () => (await data()).cycles[0].goal_ids)
    .toContain(goal.id);
  await page
    .getByRole("button", { name: "Запланировать действия", exact: true })
    .click();
  await page.getByLabel("Действие", { exact: true }).fill("Силовая тренировка");
  await page.getByLabel("С недели", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Добавить 36 действий", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await data()).tasks.filter((t) => t.goal_id === goal.id).length,
    )
    .toBe(36);
  await page.getByRole("button", { name: "Неделя 1", exact: true }).click();
  await expect(page.locator(".weekly-task")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Выполнить: Силовая тренировка", exact: true })
    .first()
    .click();
  await expect(page.locator(".execution-score strong")).toHaveText("33%");
  await page.getByLabel("Только невыполненные").check();
  await expect(page.locator(".weekly-task")).toHaveCount(2);
  await expect(page.locator(".execution-score strong")).toHaveText("33%");
  await page.getByLabel("Только невыполненные").uncheck();
  await expect(page.locator(".weekly-task")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Следующая неделя", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Неделя 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".day-group")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Предыдущая неделя", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Предыдущая неделя", exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Итоги недели", exact: true }).click();
  await page.getByLabel("Что получилось?").fill("Первая тренировка выполнена.");
  await page
    .getByLabel("Что изменю на следующей неделе?")
    .fill("Выделить время утром.");
  await page.getByRole("button", { name: "Сохранить итоги недели" }).click();
  await expect
    .poll(async () => (await data()).cycles[0].reviews["0"].wins)
    .toBe("Первая тренировка выполнена.");
  await page.getByRole("tab", { name: "План недели", exact: true }).click();
  await page.screenshot({ path: "test-results/cycle.png", fullPage: true });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "12 недель.", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".week-strip button")).toHaveCount(12);
  await page.getByRole("button", { name: "Планнер", exact: true }).click();
  await page
    .getByRole("button", { name: "Сегодня", exact: false })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Новая задача", exact: false })
    .click();
  await expect(
    page.getByRole("radio", { name: /Задача Конкретное/ }),
  ).toBeChecked();
  await expect(page.getByLabel("Время начала")).toBeVisible();
  await page.getByRole("radio", { name: /Майлстоун/ }).check();
  await expect(page.getByLabel("Время начала")).toHaveCount(0);
  await page.getByRole("radio", { name: /Задача Конкретное/ }).check();
  await expect(page.getByLabel("Время начала")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Название задачи" })
    .fill("Действие из другого списка");
  await page
    .getByRole("combobox", { name: "Тег майлстоуна" })
    .selectOption(goal.id);
  await page
    .getByRole("button", { name: "Приоритет 3 из 5", exact: true })
    .last()
    .click();
  await page
    .getByRole("combobox", { name: "Длительность задачи", exact: true })
    .click();
  await page.getByRole("option", { name: "15 мин", exact: true }).click();
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const tagged = await taskByTitle("Действие из другого списка");
  expect(tagged.goal_id).toBe(goal.id);
  expect(tagged.list_id).not.toBe(goal.list_id);
  expect(tagged.duration).toBe(15);
  const taggedCard = page.locator(`.task-card[data-task-id="${tagged.id}"]`);
  await expect(taggedCard.locator(".milestone-tag")).toHaveText(
    "# Пожать свой вес",
  );
  expect(
    await taggedCard.evaluate((el) =>
      el.style.getPropertyValue("--list-color"),
    ),
  ).toBe("#ef9a9a");
  await page.getByRole("button", { name: "Таймлайн", exact: true }).click();
  await expect(page.locator(".timeline-row")).toHaveCount(
    (await data()).lists.length,
  );
  await expect(page.locator(".milestone")).toHaveCount(1);
  await page.locator(".milestone").click();
  await expect(page.locator(".linked-task")).toHaveCount(37);
  await expect(
    page.getByRole("combobox", { name: "Длительность задачи", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/milestone-editor.png",
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "Название задачи" })
    .fill("Жим собственного веса");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page
    .getByRole("button", { name: "Сегодня", exact: false })
    .first()
    .click();
  await expect(taggedCard.locator(".milestone-tag")).toHaveText(
    "# Жим собственного веса",
  );
  console.log(
    "PASS milestone radio cards, cross-list colored tags, linked tasks and rename persistence",
  );
  console.log(
    "PASS 12-week cycle, 36 planned actions, honest weekly score, review and reload",
  );

  await page
    .getByRole("button", { name: "Новая задача", exact: false })
    .click();
  await page
    .getByRole("textbox", { name: "Название задачи" })
    .fill("Ежедневная задача без времени");
  await page.locator('select[name="recurrence"]').selectOption("daily");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const allDayRoot = await taskByTitle("Ежедневная задача без времени");
  const occurrences = (await data()).tasks.filter(
    (t) => t.series_id === allDayRoot.id,
  );
  expect(occurrences).toHaveLength(84);
  expect(occurrences.every((t) => !t.start_time)).toBe(true);
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".all-day-task")
        .filter({ hasText: allDayRoot.title })
        .count(),
    )
    .toBeGreaterThan(1);
  await page
    .getByRole("button", { name: "Следующий период", exact: true })
    .click();
  await expect(
    page.locator(".all-day-task").filter({ hasText: allDayRoot.title }),
  ).toHaveCount(7);
  for (let i = 0; i < 10; i++)
    await page
      .getByRole("button", { name: "Следующий период", exact: true })
      .click();
  await expect
    .poll(() =>
      page
        .locator(".all-day-task")
        .filter({ hasText: allDayRoot.title })
        .count(),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "test-results/recurrence-horizon.png",
    fullPage: true,
  });
  await page.reload();
  await expect
    .poll(
      async () =>
        (await data()).tasks.filter((t) => t.series_id === allDayRoot.id)
          .length,
    )
    .toBe(84);
  await page
    .getByRole("button", { name: "Сегодня", exact: false })
    .first()
    .click();
  console.log(
    "PASS all-day daily recurrence appears immediately through week 12 without duplicates after reload",
  );

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(base);
  await expect(
    mobile.getByRole("heading", { name: "Сегодня.", exact: true }),
  ).toBeVisible();
  await mobile.evaluate(() => document.fonts.ready);
  await mobile.screenshot({
    path: "test-results/mobile-tasks.png",
    fullPage: true,
  });
  expect(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await mobile.getByRole("button", { name: "Открыть меню" }).click();
  await mobile.getByRole("button", { name: "Статистика", exact: true }).click();
  await mobile.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await mobile.getByRole("button", { name: "12 недель", exact: true }).click();
  await expect(mobile.locator(".week-strip button")).toHaveCount(12);
  await mobile.screenshot({
    path: "test-results/mobile-cycle.png",
    fullPage: true,
  });
  expect(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  console.log(
    "PASS focus, settings, mobile navigation and no horizontal overflow",
  );
  expect(errors).toEqual([]);
  console.log("PASS no browser runtime errors");
} catch (error) {
  await page.screenshot({ path: "test-results/failure.png", fullPage: true });
  throw error;
} finally {
  await browser.close();
}
