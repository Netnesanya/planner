import { addDays, Task } from "../../../src/app/models";
import { expandRecurrences } from "../../../src/app/recurrence";
import { exportCalendar } from "../../../src/app/integrations/calendar-transfer";
import { zonedParts } from "../../../src/app/integrations/calendar-time";
import { tokenDigest } from "../../../src/app/integrations/calendar-capability";
export interface FeedSubscription {
  id: string;
  name: string;
  list_ids: string[];
  timezone: string;
  include_completed: boolean;
  include_milestones: boolean;
  created_at: string;
}
export interface FeedPayload {
  subscription: FeedSubscription;
  tasks: Task[];
  occupied?: { series_id: string; series_date: string }[];
}
export type ResolveFeed = (hash: string) => Promise<FeedPayload | null>;
type StampedTask = Task & {
  calendar_revision?: number;
  calendar_updated_at?: string;
};
// Stable series identity survives virtual generation, later materialization and moves.
export const feedUid = (task: Task) =>
  task.series_id && task.series_date
    ? `series-${task.series_id}-${task.series_date}@flow-planner`
    : `${task.id}@flow-planner`;
export function renderFeed(payload: FeedPayload, now: number) {
  const s = payload.subscription;
  const today = zonedParts(now, s.timezone).date;
  const occupied = new Map<string, string[]>();
  for (const slot of payload.occupied || [])
    occupied.set(slot.series_id, [
      ...(occupied.get(slot.series_id) || []),
      slot.series_date,
    ]);
  const source = payload.tasks.map((t) => ({
    ...t,
    series_skips: [
      ...new Set([...(t.series_skips || []), ...(occupied.get(t.id) || [])]),
    ],
  }));
  const rootCreated = new Map(source.map((t) => [t.id, t.created_at]));
  const tasks = expandRecurrences(source, today, "local", {
    tasks: 20000,
    steps: 100000,
  }).map((t) => ({
    ...t,
    calendar_updated_at:
      (t as StampedTask).calendar_updated_at ||
      rootCreated.get(t.series_id || t.id) ||
      t.created_at,
    start_time: t.start_time?.slice(0, 5) || null,
  }));
  if (tasks.length > 20000) throw Error("Calendar limit");
  const result = exportCalendar(
    tasks,
    {
      from: addDays(today, -28),
      to: addDays(today, 83),
      zone: s.timezone,
      listIds: s.list_ids,
      completed: s.include_completed,
      milestones: s.include_milestones,
      eventIdentity: feedUid,
      eventModified: (t) =>
        (t as StampedTask).calendar_updated_at || t.created_at,
      eventSequence: (t) => (t as StampedTask).calendar_revision || 0,
    },
    Date.parse(s.created_at),
  );
  // A partial successful response could make a subscriber delete skipped events.
  if (
    result.issues.some(
      (i) => i.reason !== "Нет даты — событие не экспортировано.",
    )
  )
    throw Error("Unsupported event time");
  return result.text;
}
export function createFeedHandler(resolve: ResolveFeed, clock = Date.now) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    };
    const respond = (
      body: string,
      status: number,
      extra: Record<string, string> = {},
    ) =>
      new Response(request.method === "HEAD" ? null : body, {
        status,
        headers: { ...headers, ...extra },
      });
    if (!["GET", "HEAD"].includes(request.method))
      return respond("Method not allowed", 405, { Allow: "GET, HEAD" });
    const url = new URL(request.url);
    // Only this exact route is supported. Do not log request URLs or tokens.
    const token = url.searchParams.get("token") || "";
    if (!/^[a-f0-9]{64}$/.test(token))
      return respond("Calendar unavailable", 404);
    try {
      const payload = await resolve(await tokenDigest(token));
      if (!payload) return respond("Calendar unavailable", 404);
      const body = renderFeed(payload, clock());
      const etag = '"' + (await tokenDigest(body)) + '"';
      // Resolve authorization before honoring conditional requests.
      if (request.headers.get("if-none-match") === etag)
        return new Response(null, {
          status: 304,
          headers: { ...headers, ETag: etag },
        });
      return respond(body, 200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="flow.ics"',
        ETag: etag,
      });
    } catch {
      return respond("Calendar temporarily unavailable", 503, {
        "Retry-After": "300",
      });
    }
  };
}
