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
            viewport: { width, height: 844 },
            locale: "ru-RU",
          }
        : { viewport: { width, height: 1200 }, locale: "ru-RU" },
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4200");
    await page
      .getByRole("button", { name: "Долгосрочные цели", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "+ Новая цель", exact: true }),
    ).toBeEnabled();
    const create = async (title, priority, status = "active") => {
      await page
        .getByRole("button", { name: "+ Новая цель", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Долгосрочная цель",
        exact: true,
      });
      await dialog.getByLabel("Название", { exact: true }).fill(title);
      expect(
        await dialog.evaluate((d) =>
          [...d.querySelectorAll("input,select,textarea")].every(
            (el) =>
              el.getBoundingClientRect().right <=
              d.getBoundingClientRect().right - 8,
          ),
        ),
      ).toBe(true);
      await dialog.locator(".stars button").first().focus();
      await page.keyboard.press("Home");
      for (let i = 0; i < priority; i++)
        await page.keyboard.press("ArrowRight");
      await dialog.locator("select[name=status]").selectOption(status);
      await dialog
        .getByLabel("Ближайший шаг", { exact: true })
        .fill("Выбрать одно небольшое действие");
      await dialog
        .getByRole("button", { name: "Сохранить цель", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
    };
    await create("Свободно говорить по-испански", 4);
    await create("Свой дом", 5);
    await create("Полумарафон", 3);
    await create("Путешествие в Японию", 2);
    await create("Собственная мастерская", 5, "future");
    await expect(page.locator(".podium-card.first h2")).toHaveText("Свой дом");
    await expect(page.locator(".podium-card.second h2")).toHaveText(
      "Свободно говорить по-испански",
    );
    await expect(page.locator(".podium-card.third h2")).toHaveText(
      "Полумарафон",
    );
    await expect(page.locator(".goal-row")).toHaveCount(2);
    const first = await page.locator(".first").boundingBox(),
      second = await page.locator(".second").boundingBox(),
      third = await page.locator(".third").boundingBox();
    expect(first.y).toBeLessThan(second.y);
    expect(second.y).toBeLessThan(third.y);
    expect(first.width).toBeGreaterThan(second.width);
    expect(second.width).toBeGreaterThan(third.width);
    expect(second.x).toBeLessThan(first.x);
    expect(first.x).toBeLessThan(third.x);
    const row = await page.locator(".goal-row").first().boundingBox();
    expect(row.height).toBeLessThanOrEqual(33);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `test-results/long-goals-${width}.png`,
      fullPage: true,
    });
    await page.locator(".goal-row").filter({ hasText: "Путешествие" }).click();
    let dialog = page.getByRole("dialog", {
      name: "Долгосрочная цель",
      exact: true,
    });
    await dialog.locator(".stars button").first().focus();
    await page.keyboard.press("End");
    await dialog
      .getByRole("button", { name: "Сохранить цель", exact: true })
      .click();
    await expect(page.locator(".podium-card.second h2")).toHaveText(
      "Путешествие в Японию",
    );
    await page.reload();
    await expect(page.locator(".podium-card.first h2")).toHaveText("Свой дом");
    // Another isolated tab must merge a new goal without dropping the first tab's goals.
    const tab = await context.newPage();
    await tab.goto("http://127.0.0.1:4200");
    await expect(tab.locator(".podium-card")).toHaveCount(3);
    const prepare = async (target, title) => {
      await target
        .getByRole("button", { name: "+ Новая цель", exact: true })
        .click();
      const d = target.getByRole("dialog", {
        name: "Долгосрочная цель",
        exact: true,
      });
      await d.getByLabel("Название", { exact: true }).fill(title);
      await d.locator("select[name=status]").selectOption("future");
      return d.getByRole("button", { name: "Сохранить цель", exact: true });
    };
    const saveA = await prepare(page, "План из первой вкладки"),
      saveB = await prepare(tab, "План из второй вкладки");
    await Promise.all([saveA.click(), saveB.click()]);
    await expect(
      page.getByRole("dialog", { name: "Долгосрочная цель", exact: true }),
    ).not.toBeVisible();
    await expect(
      tab.getByRole("dialog", { name: "Долгосрочная цель", exact: true }),
    ).not.toBeVisible();
    await page.reload();
    await expect(page.locator(".goal-row")).toHaveCount(4);
    await expect(
      page.locator(".goal-row").filter({ hasText: "План из первой вкладки" }),
    ).toHaveCount(1);
    await expect(
      page.locator(".goal-row").filter({ hasText: "План из второй вкладки" }),
    ).toHaveCount(1);
    await tab.close();
    await page.getByRole("button", { name: "Финансы", exact: true }).click();
    await page
      .getByRole("button", { name: "Добавить первый счёт", exact: true })
      .click();
    await page
      .getByLabel("Название счёта", { exact: true })
      .fill("Основная карта");
    await page.locator("input[name=opening]").fill("10000");
    await page
      .getByRole("button", { name: "Добавить счёт", exact: true })
      .click();
    await page.getByRole("button", { name: "Накопления", exact: true }).click();
    const savings = async (title, target) => {
      await page
        .getByRole("button", { name: "+ Новое накопление", exact: true })
        .click();
      const d = page.getByRole("dialog", {
        name: "Новое накопление",
        exact: true,
      });
      await d.getByLabel("Название накопления", { exact: true }).fill(title);
      await d.getByLabel("Нужная сумма", { exact: true }).fill(target);
      await d
        .getByRole("button", { name: "Сохранить накопление", exact: true })
        .click();
      await expect(d).not.toBeVisible();
    };
    await savings("На свой дом", "150000");
    await savings("На отпуск", "3000");
    const reserve = async (title, amount) => {
      await page
        .locator(".savings-card")
        .filter({ hasText: title })
        .getByRole("button", { name: "Распределить деньги", exact: true })
        .click();
      const d = page.getByRole("dialog", {
        name: "Распределить деньги",
        exact: true,
      });
      await d.getByLabel("Сумма распределения", { exact: true }).fill(amount);
      await d
        .getByRole("button", { name: "Зарезервировать", exact: true })
        .click();
      return d;
    };
    let allocation = await reserve("На свой дом", "8000");
    await expect(allocation).not.toBeVisible();
    allocation = await reserve("На отпуск", "3000");
    await expect(allocation.getByRole("alert")).toContainText("недостаточно");
    await allocation
      .getByLabel("Сумма распределения", { exact: true })
      .fill("2000");
    await allocation
      .getByRole("button", { name: "Зарезервировать", exact: true })
      .click();
    await expect(allocation).not.toBeVisible();
    await page.screenshot({
      path: `test-results/savings-${width}.png`,
      fullPage: true,
    });
    await page
      .locator(".savings-card")
      .filter({ hasText: "На свой дом" })
      .getByRole("button", { name: "Распределить деньги", exact: true })
      .click();
    allocation = page.getByRole("dialog", {
      name: "Распределить деньги",
      exact: true,
    });
    await allocation
      .locator("select[name=allocationDirection]")
      .selectOption("release");
    await allocation
      .getByLabel("Сумма распределения", { exact: true })
      .fill("1000");
    await allocation
      .getByRole("button", { name: "Освободить деньги", exact: true })
      .click();
    await expect(allocation).not.toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Накопления", exact: true }).click();
    await expect(page.locator(".savings-card")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
    console.log(
      `${engine.name()} ${width}: goals, podium, savings, balance guards and reload PASS`,
    );
  } finally {
    await browser.close();
  }
}
