import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(process.env.FLOW_TEST_URL || "http://127.0.0.1:4200");
  const data = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("flow.planner.v1")));
  await page
    .getByRole("button", { name: "Новая задача", exact: false })
    .click();
  await page.getByLabel("Название задачи", { exact: true }).fill("Undo daily");
  await page.locator("select[name=recurrence]").selectOption("daily");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  let tasks = (await data()).tasks.filter((t) => t.title === "Undo daily");
  expect(tasks.length).toBe(84);
  const root = tasks.find((t) => t.id === t.series_id);
  await page.getByRole("button", { name: "Вернуть", exact: true }).click();
  expect((await data()).tasks.some((t) => t.title === "Undo daily")).toBe(
    false,
  );
  // Seed a deterministic series from the saved result, with no cloud account.
  await page.evaluate((tasks) => {
    const d = JSON.parse(localStorage.getItem("flow.planner.v1"));
    d.tasks = tasks;
    localStorage.setItem("flow.planner.v1", JSON.stringify(d));
  }, tasks);
  await page.reload();
  const open = async (id) => {
    await page.locator(`[data-task-id="${id}"] .task-title`).first().click();
  };
  await open(root.id);
  await expect(
    page.getByLabel("Только эта задача", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Пропустить это повторение" }).click();
  expect((await data()).tasks).toHaveLength(83);
  await page.getByRole("button", { name: "Вернуть", exact: true }).click();
  expect((await data()).tasks).toHaveLength(84);
  await open(root.id);
  await page.getByLabel("Название задачи", { exact: true }).fill("Today only");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  expect(
    (await data()).tasks.filter((t) => t.title === "Today only"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Вернуть", exact: true }).click();
  await open(root.id);
  await page.getByLabel("Эта и будущие", { exact: true }).check();
  await page.getByLabel("Название задачи", { exact: true }).fill("New routine");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  expect(
    (await data()).tasks.filter((t) => t.title === "New routine"),
  ).toHaveLength(84);
  // A competing edit must be preserved, not overwritten by undo.
  await page.evaluate((id) => {
    const d = JSON.parse(localStorage.getItem("flow.planner.v1"));
    d.tasks.find((t) => t.id === id).title = "Other tab";
    localStorage.setItem("flow.planner.v1", JSON.stringify(d));
  }, root.id);
  await page.getByRole("button", { name: "Вернуть", exact: true }).click();
  await expect(page.locator(".error-toast")).toContainText("уже изменилась");
  expect((await data()).tasks.find((t) => t.id === root.id).title).toBe(
    "Other tab",
  );
  await page.reload();
  await open(root.id);
  await page
    .getByRole("button", { name: "Удалить задачу", exact: true })
    .click();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  expect((await data()).tasks).toHaveLength(83);
  await page.getByRole("button", { name: "Вернуть", exact: true }).click();
  expect((await data()).tasks).toHaveLength(84);
  console.log(
    "PASS creation/delete/skip undo, first occurrence isolation, future scope and concurrent local edit protection",
  );
} finally {
  await browser.close();
}
