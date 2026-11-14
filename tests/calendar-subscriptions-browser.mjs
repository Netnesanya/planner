import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const owner = "11111111-1111-4111-8111-111111111111",
  list = "22222222-2222-4222-8222-222222222222";
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
let rows = [],
  hashes = [];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.addInitScript(
    ({ user, token }) => {
      localStorage.setItem(
        "flow.connection.v1",
        JSON.stringify({
          supabaseUrl: "https://calendar-test.supabase.co",
          supabaseKey: "test-key",
        }),
      );
      localStorage.setItem(
        "sb-calendar-test-auth-token",
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
  await page.route("https://calendar-test.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON();
    let result = [];
    if (url.pathname === "/auth/v1/user") result = user;
    if (url.pathname.endsWith("/lists"))
      result = [
        { id: list, name: "Test list", owner_id: owner, color: "#b9efc9" },
      ];
    if (url.pathname.endsWith("/calendar_subscriptions")) result = rows;
    if (url.pathname.endsWith("/create_calendar_subscription")) {
      hashes.push(body.digest);
      rows = [
        {
          id: "subscription",
          name: body.subscription_name,
          list_ids: body.selected_lists,
          timezone: body.zone,
          revoked_at: null,
        },
      ];
      result = "subscription";
    }
    if (url.pathname.endsWith("/rotate_calendar_subscription")) {
      hashes.push(body.digest);
      result = null;
    }
    if (url.pathname.endsWith("/revoke_calendar_subscription")) {
      rows[0].revoked_at = new Date().toISOString();
      result = null;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto(process.env.FLOW_TEST_URL || "http://127.0.0.1:4200");
  // Settings are available through the desktop sidebar; use desktop to open, then mobile.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Календари", exact: true }).click();
  await page
    .getByRole("button", { name: "Подписка по ссылке", exact: true })
    .click();
  const pane = page.locator("app-calendar-subscriptions");
  await expect(pane.getByLabel("Test list", { exact: true })).toBeVisible();
  await pane.getByLabel("Test list", { exact: true }).check();
  await expect(
    pane.getByRole("button", { name: "Создать ссылку", exact: true }),
  ).toBeDisabled();
  await pane.getByRole("checkbox", { name: /Понимаю:/ }).check();
  await pane
    .getByRole("button", { name: "Создать ссылку", exact: true })
    .click();
  const first = await pane
    .getByLabel("Ссылка подписки", { exact: true })
    .inputValue();
  expect(new URL(first).searchParams.get("token")).toMatch(/^[a-f0-9]{64}$/);
  expect(hashes[0]).not.toBe(new URL(first).searchParams.get("token"));
  await pane.getByRole("button", { name: "Новая ссылка", exact: true }).click();
  await pane.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(
    pane.getByLabel("Ссылка подписки", { exact: true }),
  ).not.toHaveValue(first);
  const second = await pane
    .getByLabel("Ссылка подписки", { exact: true })
    .inputValue();
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  if (stored.includes(new URL(second).searchParams.get("token")))
    throw Error("Token persisted");
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/calendar-subscriptions-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile overflow");
  await pane.getByRole("button", { name: "Отозвать", exact: true }).click();
  await pane.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(pane.getByLabel("Ссылка подписки", { exact: true })).toHaveCount(
    0,
  );
  await expect(pane.locator("article")).toContainText("Отозвана");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS mocked cloud subscription creation, consent, rotation, revocation, secret storage and mobile layout",
  );
} finally {
  await browser.close();
}
