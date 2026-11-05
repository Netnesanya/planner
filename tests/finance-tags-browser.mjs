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
        : { locale: "ru-RU", viewport: { width, height: 1000 } },
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4200");
    await page.evaluate(async () => {
      const tags = [
        { name: "Дом", kind: "expense", importance: 5 },
        { name: "Кофе", kind: "expense", importance: 1 },
        { name: "Разное", kind: "expense", importance: 3 },
        { name: "Зарплата", kind: "income", importance: 0 },
        { name: "Разное", kind: "income", importance: 0 },
      ];
      const transactions = ["Кофе", "Кофе", "Дом", "Разное"].map((tag, i) => ({
        id: "e" + i,
        kind: "expense",
        amount: 100,
        accountId: "a",
        toAccountId: "",
        date: "2026-11-01",
        categoryId: "",
        tags: [tag],
        note: "",
        occurrenceId: "",
      }));
      for (let i = 0; i < 4; i++)
        transactions.push({
          ...transactions[0],
          id: "i" + i,
          kind: "income",
          tags: ["Зарплата"],
        });
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("flow-finance", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("books");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("books", "readwrite");
        tx.objectStore("books").put(
          {
            revision: 1,
            data: {
              version: 1,
              accounts: [
                { id: "a", name: "Карта", currency: "EUR", opening: 100000 },
              ],
              categories: [],
              tags,
              transactions,
              templates: [],
              payments: [],
            },
          },
          "local",
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    const data = () =>
      page.evaluate(async () => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open("flow-finance", 1);
          r.onsuccess = () => resolve(r.result);
        });
        return new Promise((resolve) => {
          const r = db
            .transaction("books", "readonly")
            .objectStore("books")
            .get("local");
          r.onsuccess = () => {
            db.close();
            resolve(r.result.data);
          };
        });
      });
    await page.getByRole("button", { name: "Финансы", exact: true }).click();
    await page
      .locator(".quick-actions")
      .getByRole("button", { name: "Расход", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Записать операцию" });
    await expect(dialog.locator("#transaction-amount")).toHaveCSS(
      "border-radius",
      "14px",
    );
    await expect(dialog.locator("#transaction-amount")).toHaveCSS(
      "padding-left",
      "18px",
    );
    await expect(dialog.locator(".entry-types button").first()).toHaveCSS(
      "border-radius",
      "10px",
    );
    await expect(dialog.locator(".entry-types button").first()).toHaveCSS(
      "padding-left",
      "14px",
    );
    await page.getByLabel("Сумма · EUR").fill("12,50");
    await page.screenshot({
      path: `test-results/finance-tags-form-${width}.png`,
    });
    const picker = dialog.locator("app-finance-tag-picker");
    await picker.locator(".tag-trigger").click();
    const menu = page.getByRole("region", { name: "Теги расходов — выбор" });
    await expect(menu).toBeVisible();
    const stars = menu.locator(".stars").first();
    await expect(stars.locator("button").first()).toHaveAttribute(
      "aria-label",
      "лишнее: 1 из 5, тег Кофе",
    );
    await expect(stars.locator("button").first()).toHaveText("★");
    const starBounds = await stars.locator("button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const r = button.getBoundingClientRect();
        return { x: r.x, y: r.y };
      }),
    );
    expect(starBounds).toHaveLength(5);
    expect(
      starBounds.every((rect) => Math.abs(rect.y - starBounds[0].y) < 1),
    ).toBe(true);
    expect(
      starBounds.every(
        (rect, index) => index === 0 || rect.x > starBounds[index - 1].x,
      ),
    ).toBe(true);

    await expect(menu.locator(".tag-choice b")).toHaveText([
      "#Кофе",
      "#Дом",
      "#Разное",
    ]);
    await expect(menu).not.toContainText("Зарплата");
    await menu
      .getByRole("button", {
        name: "иногда можно: 2 из 5, тег Дом",
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await data()).tags.find(
            (t) => t.kind === "expense" && t.name === "Дом",
          ).importance,
      )
      .toBe(2);
    const homeRating = menu.locator("app-expense-importance").filter({
      has: page.getByRole("button", {
        name: "лишнее: 1 из 5, тег Дом",
        exact: true,
      }),
    });
    const homeFirst = homeRating.locator("button").first();
    const clickFraction = async (button, fraction, tap = false) => {
      await button.scrollIntoViewIfNeeded();
      const buttonBox = await button.boundingBox(),
        glyph = await button.locator(".star-glyph").boundingBox();
      const position = {
        x: glyph.x - buttonBox.x + glyph.width * fraction,
        y: buttonBox.height / 2,
      };
      if (tap) await button.tap({ position });
      else await button.click({ position });
    };
    await clickFraction(homeFirst, 0.15, width < 800);
    await expect
      .poll(
        async () =>
          (await data()).tags.find(
            (t) => t.kind === "expense" && t.name === "Дом",
          ).importance,
      )
      .toBe(0);
    await expect(homeRating.locator(".importance-caption")).toHaveText(
      "1 запись · вредное",
    );
    await expect(homeRating.locator("button.filled")).toHaveCount(0);
    if (width === 1440) {
      const labels = [
        "вредное",
        "лишнее",
        "иногда можно",
        "допустимо",
        "важно",
        "необходимо",
      ];
      for (let index = 0; index < 5; index++) {
        const button = homeRating.locator("button").nth(index);
        await button.scrollIntoViewIfNeeded();
        const buttonBox = await button.boundingBox(),
          glyph = await button.locator(".star-glyph").boundingBox();
        for (const fraction of [0.15, 0.29, 0.31, 0.8]) {
          const expected = fraction < 0.3 ? index : index + 1;
          await button.hover({
            position: {
              x: glyph.x - buttonBox.x + glyph.width * fraction,
              y: buttonBox.height / 2,
            },
          });
          await expect(homeRating.locator("button.filled")).toHaveCount(
            expected,
          );
          await expect(homeRating.locator(".importance-caption")).toHaveText(
            "1 запись · " + labels[expected],
          );
          await expect(button).toHaveClass(/targeted/);
          expect(
            (await data()).tags.find(
              (t) => t.kind === "expense" && t.name === "Дом",
            ).importance,
          ).toBe(0);
        }
      }
      await homeFirst.hover({
        position: {
          x:
            (await homeFirst.locator(".star-glyph").boundingBox()).x -
            (await homeFirst.boundingBox()).x +
            2,
          y: 22,
        },
      });
      await expect(homeFirst).toHaveClass(/outlined/);
      await menu.screenshot({
        path: "test-results/finance-stars-zero-hover.png",
      });
      await menu.getByRole("searchbox").hover();
      await expect(homeRating.locator(".importance-caption")).toHaveText(
        "1 запись · вредное",
      );
      await expect(homeRating.locator("button.targeted")).toHaveCount(0);
    }
    for (const [star, fraction, expected] of [
      [1, 0.8, 1],
      [1, 0.8, 1],
      [3, 0.15, 2],
      [3, 0.8, 3],
      [5, 0.15, 4],
      [5, 0.8, 5],
      [1, 0.15, 0],
    ]) {
      await clickFraction(
        homeRating.locator("button").nth(star - 1),
        fraction,
        width < 800,
      );
      await expect
        .poll(
          async () =>
            (await data()).tags.find(
              (t) => t.kind === "expense" && t.name === "Дом",
            ).importance,
        )
        .toBe(expected);
    }
    await homeFirst.press("End");
    await expect
      .poll(
        async () =>
          (await data()).tags.find(
            (t) => t.kind === "expense" && t.name === "Дом",
          ).importance,
      )
      .toBe(5);
    await homeFirst.press("Home");
    await expect
      .poll(
        async () =>
          (await data()).tags.find(
            (t) => t.kind === "expense" && t.name === "Дом",
          ).importance,
      )
      .toBe(0);
    await menu
      .getByRole("button", {
        name: "иногда можно: 2 из 5, тег Дом",
        exact: true,
      })
      .click();
    await expect(menu.locator(".tag-choice b").first()).toHaveText("#Кофе");
    await menu.locator(".tag-choice").first().click();
    await expect(picker.locator(".selected-tags")).toContainText("Кофе");
    const search = menu.getByRole("searchbox");
    await search.fill("Подарки");
    await menu
      .getByRole("button", {
        name: "важно: 4 из 5, для нового тега",
        exact: true,
      })
      .click();
    await menu
      .getByRole("button", { name: "Создать «Подарки»", exact: true })
      .click();
    await expect(picker.locator(".selected-tags")).toContainText("Подарки");
    expect((await data()).transactions.length).toBe(8);
    await menu
      .getByRole("button", { name: "Закрыть список тегов", exact: true })
      .click();
    await dialog
      .locator(".entry-types")
      .getByRole("button", { name: "Доход", exact: true })
      .click();
    await expect(picker.locator(".selected-tags")).toHaveCount(0);
    await picker.locator(".tag-trigger").click();
    const incomeMenu = page.getByRole("region", {
      name: "Теги доходов — выбор",
    });
    await expect(incomeMenu.locator(".tag-choice b")).toHaveText([
      "#Зарплата",
      "#Разное",
    ]);
    await expect(incomeMenu.locator(".stars")).toHaveCount(0);
    await incomeMenu.getByRole("searchbox").fill("Подарки");
    await incomeMenu
      .getByRole("button", { name: "Создать «Подарки»", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await data()).tags.filter((t) => t.name === "Подарки").length,
      )
      .toBe(2);
    await incomeMenu
      .getByRole("button", { name: "Закрыть список тегов", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Записать", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect((await data()).transactions.at(-1).tags).toEqual(["Подарки"]);
    expect((await data()).transactions.at(-1).kind).toBe("income");
    await page
      .locator(".finance-tabs")
      .getByRole("button", { name: "Настройки", exact: true })
      .click();
    const manager = page
      .locator("app-finance-tag-picker")
      .filter({ has: page.getByText("Теги расходов", { exact: true }) });
    await manager
      .getByRole("button", { name: "Создать тег", exact: true })
      .click();
    const manageMenu = page.getByRole("region", {
      name: "Теги расходов — выбор",
    });
    await manageMenu.getByRole("searchbox").fill("ЖКХ");
    await manageMenu
      .getByRole("button", {
        name: "необходимо: 5 из 5, для нового тега",
        exact: true,
      })
      .click();
    await manageMenu
      .getByRole("button", { name: "Создать «ЖКХ»", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await data()).tags.some((t) => t.name === "ЖКХ" && t.importance === 5),
      )
      .toBe(true);
    await manageMenu
      .getByRole("button", { name: "Закрыть список тегов", exact: true })
      .click();
    await expect(manager.locator(".managed-tags")).toContainText("Кофе");
    await expect(manager.locator(".managed-tags")).toContainText("ЖКХ");
    await page.reload();
    await page
      .locator(".quick-actions")
      .getByRole("button", { name: "Расход", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .locator("app-finance-tag-picker .tag-trigger")
      .click();
    const finalMenu = page.getByRole("region", {
      name: "Теги расходов — выбор",
    });
    await expect(finalMenu.locator(".tag-choice b")).toHaveText([
      "#Кофе",
      "#Дом",
      "#Разное",
      "#ЖКХ",
      "#Подарки",
    ]);
    await expect
      .poll(
        async () =>
          (await data()).tags.find(
            (t) => t.name === "Подарки" && t.kind === "expense",
          ).importance,
      )
      .toBe(4);
    const rect = await finalMenu.boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `test-results/finance-tags-menu-${width}.png`,
    });
    await finalMenu.getByRole("searchbox").press("Escape");
    await expect(finalMenu).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    console.log(
      `PASS ${engine.name()} ${width}: rounded/padded inputs, frequency order, separate income/expense tags, create/rate, settings, persistence, Escape, no overflow/runtime errors`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
