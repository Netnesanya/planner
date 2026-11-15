import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const baseUrl = process.env.FLOW_TEST_URL || "http://127.0.0.1:4200";
  await page.goto(baseUrl);
  const seed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("flow.planner.v1")),
  );
  const owner = "11111111-1111-4111-8111-111111111111";
  const list = { ...seed.lists[0], owner_id: owner };
  const task = {
    ...seed.tasks[0],
    id: "33333333-3333-4333-8333-333333333333",
    created_by: owner,
    list_id: list.id,
    title: "Cloud draft",
    recurrence: "none",
    series_id: null,
    series_date: null,
    series_skips: [],
    series_until: null,
    source_task_id: null,
    goal_id: null,
    is_milestone: false,
    status: "todo",
    calendar_revision: 1,
  };
  let rows = [task],
    fail = false,
    conflict = false,
    writeCalls = 0;
  const user = {
    id: owner,
    aud: "authenticated",
    role: "authenticated",
    email: "test@example.test",
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const token =
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({
        sub: owner,
        role: "authenticated",
        aud: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url") +
    ".signature";
  await page.addInitScript(
    ({ user, token }) => {
      localStorage.setItem(
        "flow.connection.v1",
        JSON.stringify({
          supabaseUrl: "https://sync-test.supabase.co",
          supabaseKey: "test-key",
        }),
      );
      localStorage.setItem(
        "sb-sync-test-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "test",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
      );
    },
    { user, token },
  );
  await page.route("https://sync-test.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    let result = [],
      status = 200;
    if (url.pathname === "/auth/v1/user") result = user;
    if (url.pathname.endsWith("/lists")) result = [list];
    if (url.pathname.endsWith("/tasks")) result = rows;
    if (url.pathname.endsWith("/planner_capabilities"))
      result = { checked_task_writes: true };
    if (url.pathname.endsWith("/apply_task_changes_checked")) {
      writeCalls++;
      const changes = route.request().postDataJSON().changes;
      expect(changes[0].before.calendar_revision).toBe(1);
      if (fail || conflict) {
        status = 400;
        result = {
          code: "P0001",
          message: conflict
            ? "Task changed; undo cancelled"
            : "Temporary write failure",
        };
      } else {
        rows = changes.map((c) => ({ ...c.after, calendar_revision: 2 }));
        result = rows;
      }
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Все задачи", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Cloud draft", exact: true }),
  ).toBeVisible();
  await expect(page.locator("app-sync-status")).not.toContainText(
    "Базовый режим",
  );
  await page.getByRole("button", { name: "Cloud draft", exact: true }).click();
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Recovered draft");
  fail = true;
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".editor-error")).toContainText(
    "Temporary write failure",
  );
  await expect(page.locator("app-sync-status")).toContainText("Не сохранено");
  expect(rows[0].title).toBe("Cloud draft");
  fail = false;
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("app-task-editor")).toHaveCount(0);
  await expect(page.locator("app-sync-status")).toContainText(
    "Сохранено в облаке",
  );
  expect(rows[0].title).toBe("Recovered draft");
  expect(writeCalls).toBe(2);
  rows = [task];
  await page.reload();
  await page
    .getByRole("button", { name: "Все задачи", exact: false })
    .first()
    .click();
  fail = true;
  await page
    .getByRole("button", { name: "Выполнить: Cloud draft", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Повторить сохранение", exact: true }),
  ).toBeVisible();
  fail = false;
  await page
    .getByRole("button", { name: "Повторить сохранение", exact: true })
    .click();
  await expect(page.locator("app-sync-status")).toContainText(
    "Сохранено в облаке",
  );
  expect(rows[0].status).toBe("done");
  // Load a fresh test snapshot; emulate a conflicting write on the server.
  rows = [task];
  await page.reload();
  await page
    .getByRole("button", { name: "Все задачи", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Cloud draft", exact: true }).click();
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Conflict draft");
  rows = [{ ...task, title: "Remote edit", calendar_revision: 2 }];
  conflict = true;
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".editor-error")).toContainText(
    "изменилась на другом устройстве",
  );
  await expect(page.getByLabel("Название задачи", { exact: true })).toHaveValue(
    "Conflict draft",
  );
  expect(rows[0].title).toBe("Remote edit");
  const count = writeCalls;
  await page.context().setOffline(true);
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".editor-error")).toContainText("Нет сети");
  expect(writeCalls).toBe(count);
  await page.context().setOffline(false);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Не сохранять", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Повторить сохранение", exact: true }),
  ).toHaveCount(0);
  console.log(
    "PASS checked cloud writes, retained draft, retry, conflict rejection and offline write guard",
  );
} finally {
  await browser.close();
}
