import { writeFile } from "node:fs/promises";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
if (!!supabaseUrl !== !!supabaseKey)
  throw new Error("Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.");
if (supabaseUrl) {
  const url = new URL(supabaseUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Supabase URL must use HTTPS and contain no credentials.");
}
if (supabaseKey.startsWith("sb_secret_"))
  throw new Error("Use a public Supabase key, never a secret key.");
if (supabaseKey.split(".").length === 3) {
  const payload = JSON.parse(
    Buffer.from(supabaseKey.split(".")[1], "base64url").toString(),
  );
  if (payload.role !== "anon")
    throw new Error("Only the legacy anon role is allowed in browser bundles.");
} else if (supabaseKey && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseKey))
  throw new Error("Use a public Supabase publishable key.");
await writeFile(
  "public/config.js",
  `window.FLOW_CONFIG = ${JSON.stringify({ supabaseUrl, supabaseKey }).replace(/</g, "\\u003c")};\n`,
);
