import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("runtime configuration accepts public keys and rejects server keys before writing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flow-config-"));
  const script = fileURLToPath(
    new URL("../scripts/write-config.mjs", import.meta.url),
  );
  await mkdir(join(cwd, "public"));
  const run = (key: string) =>
    spawnSync(process.execPath, [script], {
      cwd,
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: key,
      },
      encoding: "utf8",
    });
  try {
    assert.equal(run("sb_publishable_example").status, 0);
    const valid = await readFile(join(cwd, "public/config.js"), "utf8");
    assert.match(valid, /sb_publishable_example/);
    const jwt = (role: string) =>
      `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
    for (const key of [
      "sb_secret_example",
      jwt("service_role"),
      jwt("authenticated"),
      "random-secret",
      "",
    ]) {
      assert.notEqual(run(key).status, 0);
      assert.equal(
        await readFile(join(cwd, "public/config.js"), "utf8"),
        valid,
      );
    }
    assert.equal(run(jwt("anon")).status, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
