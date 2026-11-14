import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const data = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("flow.planner.v1")));
try {
  await page.goto(process.env.FLOW_TEST_URL || "http://127.0.0.1:4200");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Календари", exact: true }).click();
  const pane = page.locator("app-calendar-transfer");
  await expect(pane).toBeVisible();
  const date = await pane.getByLabel("Начало диапазона календаря").inputValue();
  const stamp = date.replaceAll("-", "");
  const fixture = (title) =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//EN",
      "BEGIN:VEVENT",
      "UID:browser-import",
      "DTSTART:" + stamp + "T100000",
      "DTEND:" + stamp + "T110000",
      "SUMMARY:" + title,
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:unsupported",
      "DTSTART;VALUE=DATE:" + stamp,
      "DURATION:P2D",
      "SUMMARY:Multiple days",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
  const upload = async (title) =>
    pane
      .getByLabel("Файл календаря .ics")
      .setInputFiles({
        name: "calendar.ics",
        mimeType: "text/calendar",
        buffer: Buffer.from(fixture(title)),
      });
  const count = (await data()).tasks.length;
  await upload("Calendar browser test");
  await expect(pane.locator(".preview-summary")).toContainText("1 новых");
  if ((await data()).tasks.length !== count)
    throw Error("Preview mutated tasks");
  await expect(pane.locator(".issues")).toContainText("1");
  await pane
    .getByRole("button", { name: "Импортировать выбранные (1)", exact: true })
    .click();
  await expect(pane.locator(".success")).toContainText("сохранено 1");
  await upload("Calendar browser test");
  await expect(pane.locator(".preview-summary")).toContainText(
    "1 без изменений",
  );
  await upload("Calendar updated");
  await expect(pane.locator(".preview-summary")).toContainText("1 обновлений");
  await expect(
    pane.getByRole("button", {
      name: "Импортировать выбранные (0)",
      exact: true,
    }),
  ).toBeDisabled();
  await pane
    .getByRole("checkbox", { name: /Импортировать Calendar updated/ })
    .check();
  await pane
    .getByRole("button", { name: "Импортировать выбранные (1)", exact: true })
    .click();
  await expect(pane.locator(".success")).toContainText("сохранено 1");
  if ((await data()).tasks.length !== count + 1)
    throw Error("Duplicate import");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/calendar-import.png",
    fullPage: true,
  });
  await pane
    .getByRole("button", { name: "Экспорт календаря", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await pane.getByRole("button", { name: "Скачать .ics", exact: true }).click();
  const download = await downloadPromise;
  const text = await readFile(await download.path(), "utf8");
  if (!text.includes("SUMMARY:Calendar updated"))
    throw Error("Missing exported task");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/calendar-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile overflow");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS calendar worker, preview, import, deduplication, opt-in updates, export and mobile layout",
  );
} finally {
  await browser.close();
}
