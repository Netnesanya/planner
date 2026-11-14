import { createFeedHandler } from "./handler";
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.serve(
  createFeedHandler(async (digest) => {
    if (!url || !key) throw Error("Missing configuration");
    const response = await fetch(
      url + "/rest/v1/rpc/resolve_calendar_subscription",
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ digest }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw Error("Calendar query failed");
    return await response.json();
  }),
);
