import { webkit, devices, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
const browser = await webkit.launch();
try {
  for (const width of [320, 390, 430]) {
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: { width, height: 844 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const noOverflow = async () =>
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    await page.goto("http://127.0.0.1:4200");
    await page.getByRole("button", { name: "12 недель", exact: true }).click();
    await page.getByRole("button", { name: "Создать первый цикл" }).click();
    await expect(page.getByLabel("Название", { exact: true })).toHaveCSS(
      "font-size",
      "16px",
    );
    await noOverflow();
    await page
      .getByRole("button", { name: "Начать 12 недель", exact: true })
      .click();
    await expect(page.locator(".week-strip button")).toHaveCount(12);
    for (const selector of [
      ".week-strip button",
      ".cycle-tabs button",
      ".week-navigation button",
      ".cycle-toolbar button",
    ]) {
      const boxes = await page.locator(selector).evaluateAll((elements) =>
        elements.map((el) => {
          const r = el.getBoundingClientRect();
          return { width: r.width, height: r.height };
        }),
      );
      expect(boxes.every((box) => box.width >= 44 && box.height >= 44)).toBe(
        true,
      );
    }
    await page
      .getByRole("button", { name: "Следующая неделя", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Неделя 2", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: "Итоги недели", exact: true }).click();
    await page.getByLabel("Что получилось?").fill("Проверка мобильной формы");
    await expect(page.getByLabel("Что получилось?")).toHaveCSS(
      "font-size",
      "16px",
    );
    await page.getByRole("button", { name: "Сохранить итоги недели" }).click();
    await noOverflow();
    await page.getByRole("tab", { name: "План недели", exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `test-results/webkit-cycle-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Планнер", exact: true }).click();
    await page
      .getByRole("button", { name: "Новая задача", exact: false })
      .click();
    await page
      .getByRole("textbox", { name: "Название задачи" })
      .fill("Проверка на iPhone");
    await page
      .locator(".task-editor")
      .evaluate((el) =>
        Promise.all(el.getAnimations().map((animation) => animation.finished)),
      );
    await noOverflow();
    await expect(
      page.locator(".editor-footer button").filter({ hasText: "Сохранить" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.locator("app-task-editor")).toHaveCount(0);
    await noOverflow();
    expect(errors).toEqual([]);
    console.log(
      `PASS WebKit touch ${width}px: cycle, 44px targets, 16px forms, review, editor, no overflow/runtime errors`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
