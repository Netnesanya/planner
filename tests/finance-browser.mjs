import { webkit, chromium, devices, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
for (const [engine, width] of [
  [webkit, 320],
  [webkit, 390],
  [webkit, 430],
  [chromium, 1440],
]) {
  if (process.env.FINANCE_WIDTH && width !== Number(process.env.FINANCE_WIDTH))
    continue;
  const browser = await engine.launch();
  try {
    const context = await browser.newContext(
      width < 800
        ? { ...devices["iPhone 13"], viewport: { width, height: 844 } }
        : { viewport: { width, height: 1000 }, locale: "ru-RU" },
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const data = () =>
      page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("flow-finance", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return new Promise((resolve, reject) => {
          const tx = db.transaction("books", "readonly");
          const request = tx.objectStore("books").get("local");
          request.onsuccess = () => {
            db.close();
            resolve(request.result?.data);
          };
          request.onerror = () => reject(request.error);
        });
      });
    const noOverflow = async () =>
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    const tab = (name) =>
      page
        .locator(".finance-tabs")
        .getByRole("button", { name, exact: true })
        .click();
    const entry = () =>
      page
        .locator("dialog")
        .filter({ has: page.locator("#transaction-amount") });
    const open = async (kind = "Расход") => {
      await page
        .locator(".quick-actions")
        .getByRole("button", { name: kind, exact: true })
        .click();
      await expect(entry()).toBeVisible();
    };
    const outsideDialog = async (dialog) => {
      const rect = await dialog.boundingBox();
      const viewport = page.viewportSize();
      const position =
        rect.y > 2
          ? { x: viewport.width / 2, y: rect.y / 2 }
          : rect.x > 2
            ? { x: rect.x / 2, y: viewport.height / 2 }
            : {
                x: viewport.width / 2,
                y: (rect.y + rect.height + viewport.height) / 2,
              };
      if (width < 800) await page.touchscreen.tap(position.x, position.y);
      else await page.mouse.click(position.x, position.y);
    };
    const save = async () => {
      await entry()
        .getByRole("button", { name: "Записать", exact: true })
        .click();
      await expect(entry()).not.toBeVisible();
    };
    await page.goto("http://127.0.0.1:4200");
    await page.getByRole("button", { name: "Финансы", exact: true }).click();
    await page.getByRole("button", { name: "Добавить первый счёт" }).click();
    const currency = page.locator('select[name="accountCurrency"]');
    await expect(currency).toHaveValue("USD");
    await expect(currency).toHaveCSS("appearance", "none");
    await expect(currency).toHaveCSS("padding-right", "48px");
    await expect(currency).toHaveCSS("border-radius", "12px");
    await expect(currency.locator("option")).toHaveText(["USD", "EUR", "RSD"]);
    await currency.selectOption("EUR");
    await page
      .getByLabel("Название счёта", { exact: true })
      .fill("Основная карта");
    await page.getByLabel("Начальный остаток", { exact: true }).fill("1000");
    await page
      .getByRole("button", { name: "Добавить счёт", exact: true })
      .click();
    await expect.poll(async () => (await data())?.accounts.length).toBe(1);
    await expect(currency).toHaveValue("USD");
    await currency.selectOption("EUR");
    await page.getByLabel("Название счёта", { exact: true }).fill("Наличные");
    await page
      .getByRole("button", { name: "Добавить счёт", exact: true })
      .click();
    await expect.poll(async () => (await data()).accounts.length).toBe(2);
    await open();
    const accountSelect = entry().locator('select[name="entryAccount"]');
    await expect(accountSelect).toHaveCSS("appearance", "none");
    await expect(accountSelect).toHaveCSS("padding-right", "48px");
    await expect(accountSelect).toHaveCSS("border-radius", "12px");
    await page.getByLabel("Сумма · EUR").fill("3,50");
    await page
      .getByLabel("Категория · необязательно", { exact: true })
      .fill("Кофе");
    await entry().locator("summary").click();
    await page
      .getByLabel("Комментарий / название", { exact: true })
      .fill("Кофе утром");
    await entry().locator("app-finance-tag-picker .tag-trigger").click();
    const tagSearch = page.getByRole("searchbox", {
      name: "Поиск или создание: Теги расходов",
    });
    for (const name of ["утро", "для себя"]) {
      await tagSearch.fill(name);
      await page
        .getByRole("button", { name: `Создать «${name}»`, exact: true })
        .click();
      await expect(entry().locator(".selected-tags")).toContainText(name);
    }
    await page
      .getByRole("button", { name: "Закрыть список тегов", exact: true })
      .click();
    await save();
    expect((await data()).transactions[0].amount).toBe(350);
    expect((await data()).categories[0].name).toBe("Кофе");
    await open();
    await page.getByLabel("Сумма · EUR").fill("12,34");
    await entry().click({ position: { x: 6, y: 6 } });
    await expect(entry()).toBeVisible();
    if (width >= 800) {
      const rect = await entry().boundingBox();
      await page.mouse.move(rect.x + 6, rect.y + 6);
      await page.mouse.down();
      await page.mouse.move(2, 2);
      await page.mouse.up();
      await expect(entry()).toBeVisible();
    }
    await outsideDialog(entry());
    await expect(entry()).not.toBeVisible();
    await open();
    await expect(page.getByLabel("Сумма · EUR")).toHaveValue("12,34");
    await page
      .getByRole("button", { name: "Закрыть ввод операции", exact: true })
      .click();
    await open("Доход");
    await page.getByLabel("Сумма · EUR").fill("200");
    await save();
    await open("Перевод");
    await page.getByLabel("Сумма · EUR").fill("25");
    const cash = (await data()).accounts[1];
    await page.locator('select[name="entryTo"]').selectOption(cash.id);
    await save();
    await tab("Платежи");
    await page
      .getByRole("button", { name: "Регулярный платёж", exact: true })
      .click();
    const paymentDialog = page.getByRole("dialog", {
      name: "Ежемесячный платёж",
      exact: true,
    });
    await paymentDialog.click({ position: { x: 6, y: 6 } });
    await expect(paymentDialog).toBeVisible();
    await outsideDialog(paymentDialog);
    await expect(paymentDialog).not.toBeVisible();
    expect((await data()).templates.length).toBe(0);
    await page
      .getByRole("button", { name: "Регулярный платёж", exact: true })
      .click();
    await page.getByLabel("Название платежа", { exact: true }).fill("Аренда");
    await page.getByLabel("Сумма · необязательно", { exact: true }).fill("800");
    await page.getByLabel("Категория", { exact: true }).fill("Жильё");
    await page.getByLabel("Число месяца", { exact: true }).fill("31");
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    await page
      .getByLabel("Начало расписания", { exact: true })
      .fill(today.slice(0, 7) + "-01");
    await page
      .getByRole("button", { name: "Сохранить расписание", exact: true })
      .click();
    await expect(page.locator(".payment-detail")).toHaveCount(1);
    await noOverflow();
    await page
      .getByRole("button", { name: "Оплачено / изменить сумму", exact: true })
      .click();
    await page.getByLabel("Сумма · EUR").fill("790");
    await save();
    expect(
      (await data()).transactions.filter((t) => t.occurrenceId).length,
    ).toBe(1);
    await expect
      .poll(
        async () =>
          (await data()).payments.filter((p) => p.status === "paid").length,
      )
      .toBe(1);
    await page
      .getByRole("button", { name: "Отменить запись", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await data()).payments.filter((p) => p.status === "paid").length,
      )
      .toBe(0);
    await page.getByRole("button", { name: "Перенести", exact: true }).click();
    await page.getByLabel("Новая дата", { exact: true }).fill(today);
    await page
      .getByRole("button", { name: "Сохранить дату", exact: true })
      .click();
    await page.getByRole("button", { name: "Пропустить", exact: true }).click();
    await expect(page.locator(".payment-detail")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Вернуть в план", exact: true })
      .click();
    await page.locator(".payment-detail summary").click();
    const expense = (await data()).transactions.find(
      (t) => t.kind === "expense",
    );
    await page
      .getByLabel("Записанный расход для платежа")
      .selectOption(expense.id);
    await page
      .getByRole("button", { name: "Связать без нового расхода", exact: true })
      .click();
    expect((await data()).transactions.length).toBe(3);
    await expect
      .poll(
        async () =>
          (await data()).payments.filter((p) => p.status === "paid").length,
      )
      .toBe(1);
    await tab("Операции");
    await expect(page.locator(".transaction")).toHaveCount(3);
    await noOverflow();
    await tab("Настройки");
    const categoryRow = page
      .locator(".settings-row")
      .filter({ has: page.getByText("Кофе", { exact: true }) });
    await categoryRow
      .getByRole("button", { name: "Изменить", exact: true })
      .click();
    await page.getByLabel("Название категории", { exact: true }).fill("Еда");
    await page
      .getByRole("button", { name: "Сохранить категорию", exact: true })
      .click();
    await expect
      .poll(async () => (await data()).categories.some((c) => c.name === "Еда"))
      .toBe(true);
    await tab("Обзор");
    await noOverflow();
    await page.screenshot({
      path: `test-results/finance-overview-${width}.png`,
      fullPage: true,
    });
    await open();
    await page.getByLabel("Сумма · EUR").fill("7,20");
    await page.screenshot({
      path: `test-results/finance-entry-${width}.png`,
      fullPage: false,
    });
    await page
      .getByRole("button", { name: "Закрыть ввод операции", exact: true })
      .click();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Финансы.", exact: true }),
    ).toBeVisible();
    expect((await data()).transactions.length).toBe(3);
    expect(errors).toEqual([]);
    await noOverflow();
    // IndexedDB serializes read-modify-write transactions across tabs.
    const second = await context.newPage();
    await second.goto("http://127.0.0.1:4200");
    const rounds = Number(process.env.FINANCE_STRESS || 1);
    for (let round = 0; round < rounds; round++) {
      await open("Доход");
      await page.getByLabel("Сумма · EUR").fill("1");
      await second
        .locator(".quick-actions")
        .getByRole("button", { name: "Доход", exact: true })
        .click();
      await second.getByLabel("Сумма · EUR").fill("2");
      await Promise.all([
        entry().getByRole("button", { name: "Записать", exact: true }).click(),
        second
          .getByRole("dialog")
          .getByRole("button", { name: "Записать", exact: true })
          .click(),
      ]);
      try {
        await expect
          .poll(async () => (await data()).transactions.length)
          .toBe(5 + round * 2);
      } catch (error) {
        console.log(
          "Concurrent transaction count:",
          (await data()).transactions.length,
        );
        throw error;
      }
    }
    await second.close();
    if (width === 390 && rounds === 1) {
      await open();
      await page.getByLabel("Сумма · EUR").fill("9,99");
      await entry().locator("summary").click();
      await page
        .getByLabel("Комментарий / название", { exact: true })
        .fill("Музыка");
      await page.getByLabel("Повторяется ежемесячно").check();
      await page
        .getByLabel("День месяца", { exact: true })
        .fill(today.slice(8));
      await save();
      await expect.poll(async () => (await data()).transactions.length).toBe(6);
      const music = (await data()).templates.find((t) => t.title === "Музыка");
      expect(
        (await data()).payments.filter(
          (p) => p.templateId === music.id && p.status === "paid",
        ),
      ).toHaveLength(1);
      await tab("Настройки");
      const row = page
        .locator(".settings-row")
        .filter({ has: page.getByText("Еда", { exact: true }) });
      await row.getByRole("button", { name: "Удалить", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Подтвердить удаление категории",
          exact: true,
        })
        .click();
      await expect
        .poll(async () =>
          (await data()).categories.some((c) => c.name === "Еда"),
        )
        .toBe(false);
      expect((await data()).transactions.length).toBe(6);
      const downloaded = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Скачать финансовую копию", exact: true })
        .click();
      const backupPath = await (await downloaded).path();
      await page
        .locator("app-finance-view input[type=file]")
        .setInputFiles(backupPath);
      await page
        .getByRole("button", { name: "Заменить финансы", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Заменить финансы", exact: true }),
      ).toHaveCount(0);
      expect((await data()).transactions.length).toBe(6);
      console.log(
        "PASS recurring expense creates one paid occurrence, category deletion preserves ledger, financial backup round trip",
      );
    }
    console.log(
      `PASS ${engine.name()} ${width}: accounts, quick entry, draft, income, transfer, payment, undo, move, skip, link without duplicate, category rename, reload, concurrent tabs, no overflow/runtime errors`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
