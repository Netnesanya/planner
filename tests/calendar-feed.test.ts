import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTask, Task } from "../src/app/models";
import { expandRecurrences } from "../src/app/recurrence";
import {
  createFeedHandler,
  FeedPayload,
  renderFeed,
} from "../supabase/functions/calendar-feed/handler";
import {
  newCalendarToken,
  tokenDigest,
} from "../src/app/integrations/calendar-capability";
const today = Date.parse("2027-05-01T12:00:00Z");
const root: Task = {
  ...makeTask("list", "owner", "2026-01-01"),
  title: "Daily",
  recurrence: "daily",
  created_at: "2026-01-01T00:00:00Z",
};
const payload: FeedPayload = {
  subscription: {
    id: "subscription",
    name: "Test",
    list_ids: ["list"],
    timezone: "Europe/Belgrade",
    include_completed: true,
    include_milestones: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  tasks: [root],
};
test("feed projects twelve weeks without a browser, with stable identities after materialization", () => {
  const text = renderFeed(payload, today);
  assert.ok(text.includes("DTSTART;VALUE=DATE:20270723"));
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 84);
  const materialized = expandRecurrences([root], "2027-05-01", "owner");
  assert.equal(renderFeed({ ...payload, tasks: materialized }, today), text);
  assert.equal(renderFeed(payload, today + 1000), text);
});
test("moved/deleted/stopped occurrences do not reappear; unselected lists never export", () => {
  const tasks = expandRecurrences([root], "2027-05-01", "owner");
  const moved = tasks.find((t) => t.series_date === "2027-05-02")!;
  moved.list_id = "other";
  const rootTask = tasks.find((t) => t.id === root.id)!;
  rootTask.series_skips = ["2027-05-03"];
  rootTask.series_until = "2027-05-04";
  const selected = tasks.filter(
    (t) =>
      !["2027-05-03"].includes(t.series_date || "") &&
      (t.series_date || "") <= "2027-05-04",
  );
  const text = renderFeed({ ...payload, tasks: selected }, today);
  assert.ok(!text.includes("DTSTART;VALUE=DATE:20270502"));
  assert.ok(!text.includes("DTSTART;VALUE=DATE:20270503"));
  assert.ok(!text.includes("DTSTART;VALUE=DATE:20270505"));
  const hidden = renderFeed(
    {
      ...payload,
      tasks: [root],
      occupied: [{ series_id: root.id, series_date: "2027-05-02" }],
    },
    today,
  );
  assert.ok(!hidden.includes("DTSTART;VALUE=DATE:20270502"));
});
test("feed token validation, hashing, conditional requests, revocation and transient errors", async () => {
  const token = newCalendarToken(),
    digest = await tokenDigest(token);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(token, newCalendarToken());
  let active = true;
  const handler = createFeedHandler(
    async (hash) => {
      assert.equal(hash, digest);
      return active ? payload : null;
    },
    () => today,
  );
  const url = "https://example.test/calendar-feed?token=" + token;
  assert.equal(
    (await handler(new Request("https://example.test"))).status,
    404,
  );
  assert.equal(
    (await handler(new Request(url, { method: "POST" }))).status,
    405,
  );
  const response = await handler(new Request(url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const etag = response.headers.get("etag")!;
  assert.equal(
    (await handler(new Request(url, { headers: { "if-none-match": etag } })))
      .status,
    304,
  );
  assert.equal(
    await (await handler(new Request(url, { method: "HEAD" }))).text(),
    "",
  );
  active = false;
  assert.equal(
    (await handler(new Request(url, { headers: { "if-none-match": etag } })))
      .status,
    404,
  );
  const failed = createFeedHandler(async () => {
    throw Error("secret token: " + token);
  });
  const unavailable = await failed(new Request(url));
  assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes(token));
});
test("changed event retains UID and advances revision, deletion removes it", () => {
  const task = {
    ...root,
    recurrence: "none" as const,
    due_date: "2027-05-01",
    calendar_revision: 1,
    calendar_updated_at: "2027-05-01T10:00:00Z",
  };
  const first = renderFeed({ ...payload, tasks: [task] }, today);
  const second = renderFeed(
    {
      ...payload,
      tasks: [
        {
          ...task,
          title: "Changed",
          calendar_revision: 2,
          calendar_updated_at: "2027-05-01T11:00:00Z",
        } as Task,
      ],
    },
    today,
  );
  assert.equal(first.match(/UID:(.*)/)![1], second.match(/UID:(.*)/)![1]);
  assert.match(second, /SEQUENCE:2/);
  assert.match(second, /DTSTAMP:20270501T110000Z/);
  assert.ok(
    !renderFeed({ ...payload, tasks: [] }, today).includes("BEGIN:VEVENT"),
  );
});

test("deployed single-file entry uses server credentials and sends only the hash to RPC", async () => {
  const originalFetch = globalThis.fetch;
  const runtime = globalThis as typeof globalThis & { Deno?: unknown };
  let handler: ((r: Request) => Promise<Response>) | undefined;
  runtime.Deno = {
    env: {
      get: (name: string) =>
        name === "SUPABASE_URL"
          ? "https://server.test"
          : "server-only-test-key",
    },
    serve: (value: typeof handler) => {
      handler = value;
    },
  };
  const token = newCalendarToken();
  globalThis.fetch = async (input, init) => {
    assert.equal(
      input,
      "https://server.test/rest/v1/rpc/resolve_calendar_subscription",
    );
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer server-only-test-key",
    );
    assert.deepEqual(JSON.parse(init?.body as string), {
      digest: await tokenDigest(token),
    });
    return Response.json(payload);
  };
  try {
    await import("../supabase/functions/calendar-feed/index");
    assert.ok(handler);
    const response = await handler(
      new Request("https://example.test/calendar-feed?token=" + token),
    );
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes("server-only-test-key"));
  } finally {
    globalThis.fetch = originalFetch;
    delete runtime.Deno;
  }
});
