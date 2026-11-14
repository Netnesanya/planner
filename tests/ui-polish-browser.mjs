import { webkit, chromium, devices, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
for (const [engine, width] of [
  [webkit, 320],
  [webkit, 390],
  [webkit, 430],
  [chromium, 1440],
]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext(
      width < 800
        ? {
            ...devices["iPhone 13"],
            locale: "ru-RU",
            viewport: { width, height: 844 },
          }
        : { locale: "ru-RU", viewport: { width, height: 1200 } },
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const noOverflow = async () =>
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    const selectStyle = async (locator) => {
      await expect(locator).toHaveCSS("appearance", "none");
      await expect(locator).toHaveCSS("padding-right", "48px");
      expect(
        await locator.evaluate((el) => getComputedStyle(el).backgroundImage),
      ).not.toBe("none");
      expect(
        await locator.evaluate((el) => getComputedStyle(el).backgroundPosition),
      ).toContain("16px");
    };
    await page.goto("http://127.0.0.1:4200");
    await page.getByRole("button", { name: "Финансы", exact: true }).click();
    await page
      .getByRole("button", { name: "Добавить первый счёт", exact: true })
      .click();
    await selectStyle(page.locator("select[name=accountCurrency]"));
    await page.getByLabel("Название счёта", { exact: true }).fill("Карта");
    await page
      .getByRole("button", { name: "Добавить счёт", exact: true })
      .click();
    await page
      .locator(".quick-actions")
      .getByRole("button", { name: "Расход", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Записать операцию",
      exact: true,
    });
    const amountBox = await dialog.locator("#transaction-amount").boundingBox(),
      labelBox = await dialog
        .locator("label[for=transaction-amount]")
        .boundingBox();
    expect(amountBox.y - labelBox.y - labelBox.height).toBeGreaterThanOrEqual(
      9,
    );
    await selectStyle(dialog.locator("select[name=entryAccount]"));
    await page.getByLabel("Сумма · USD").fill("12,50");
    const details = dialog.locator(".entry-details"),
      summary = details.locator("summary");
    const sample = () =>
      details.evaluate(async (details) => {
        const values = [];
        for (let frame = 0; frame < 90; frame++) {
          values.push({
            block: details.getBoundingClientRect().height,
            dialog: details.closest("dialog").getBoundingClientRect().height,
          });
          if (!details.getAnimations().some((a) => a.playState === "running"))
            break;
          await new Promise(requestAnimationFrame);
        }
        return values;
      });
    await page.evaluate(() => document.fonts.ready);
    const closed = (await dialog.boundingBox()).height;
    await summary.click();
    const opening = await sample();
    const expanded = (await dialog.boundingBox()).height;
    expect(expanded).toBeGreaterThan(closed + 10);
    expect(opening.length).toBeGreaterThan(2);
    if (!opening.some((v) => v.dialog > closed + 1 && v.dialog < expanded - 1))
      console.log({ width, closed, expanded, opening });
    expect(
      opening.some((v) => v.dialog > closed + 1 && v.dialog < expanded - 1),
    ).toBe(true);
    await page
      .getByLabel("Комментарий / название", { exact: true })
      .fill("Плавное раскрытие");
    await page.screenshot({
      path: `test-results/finance-expanded-${width}.png`,
    });
    await summary.click();
    const closing = await sample();
    await expect(details).not.toHaveAttribute("open");
    expect(closing.length).toBeGreaterThan(2);
    expect(
      closing.some((v) => v.dialog > closed + 1 && v.dialog < expanded - 1),
    ).toBe(true);
    expect(Math.abs((await dialog.boundingBox()).height - closed)).toBeLessThan(
      2,
    );
    await summary.click();
    await summary.click();
    await sample();
    await expect(details).not.toHaveAttribute("open");
    // Motion preference applies to both directions, with no lingering fixed height.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await summary.click();
    await expect(details).toHaveAttribute("open", "");
    expect(await details.evaluate((el) => el.getAnimations().length)).toBe(0);
    await summary.click();
    await expect(details).not.toHaveAttribute("open");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await dialog
      .getByRole("button", { name: "Закрыть ввод операции", exact: true })
      .click();
    await page.getByRole("button", { name: "Планнер", exact: true }).click();
    for (const select of await page.locator("select:visible").all())
      await selectStyle(select);
    await page
      .getByRole("button", { name: "Новая задача", exact: false })
      .click();
    for (const select of await page
      .locator("app-task-editor select:visible")
      .all())
      await selectStyle(select);
    await page
      .getByRole("button", { name: "Закрыть редактор", exact: true })
      .click();
    if (width < 800)
      await page
        .getByRole("button", { name: "Открыть меню", exact: true })
        .click();
    await page.getByRole("button", { name: "Фокус", exact: true }).click();
    await page
      .locator(".sidebar")
      .evaluate((el) =>
        Promise.all(el.getAnimations().map((animation) => animation.finished)),
      );
    const focusSelect = page.getByRole("combobox", {
      name: "Задача для фокуса",
      exact: true,
    });
    await selectStyle(focusSelect);
    await expect(focusSelect).toHaveCSS("font-size", "16px");
    const option = await focusSelect
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await focusSelect.selectOption(option);
    await expect(focusSelect).toHaveValue(option);
    await focusSelect.selectOption("");
    await page.screenshot({ path: `test-results/focus-select-${width}.png` });
    await noOverflow();
    expect(errors).toEqual([]);
    console.log(
      `PASS ${engine.name()} ${width}: amount spacing, intermediate dialog heights on open/close, rapid toggle, reduced motion, shared select arrows, focus selection, no overflow/runtime errors`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
