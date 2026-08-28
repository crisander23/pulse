import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("uses the standard Next.js/Vercel runtime scripts", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.scripts.dev, "next dev --hostname 0.0.0.0");
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.start, "next start");
});

test("poll API uses Supabase storage", async () => {
  const route = await read("app/api/polls/route.ts");
  const server = await read("lib/supabase-server.ts");

  assert.match(route, /getPublicSupabase/);
  assert.doesNotMatch(route, /cloudflare:workers|D1Database/);
  assert.match(server, /@supabase\/supabase-js/);
  assert.match(route, /from\("rooms"\)/);
});

test("supports anonymous open-ended responses", async () => {
  const page = await read("app/page.tsx");
  const route = await read("app/api/polls/route.ts");

  assert.match(page, /ONE OPEN QUESTION/);
  assert.match(page, /type: "open"/);
  assert.match(page, /Share your thoughts/);
  assert.match(page, /maxLength=\{500\}/);
  assert.match(route, /type: "open"/);
  assert.match(route, /already has its one open question/);
  assert.match(route, /from\("responses"\)/);
  assert.match(route, /participant_id/);
  assert.match(route, /answer/);
});

test("supports session history", async () => {
  const page = await read("app/page.tsx");
  const route = await read("app/api/polls/route.ts");

  assert.match(page, /Your previous sessions/);
  assert.match(page, /Session history/);
  assert.match(route, /params\.get\("list"\) === "1"/);
  assert.match(route, /from\("rooms"\)/);
  assert.match(route, /owner_id/);
  assert.match(page, /Export results/);
  assert.match(page, /text\/csv/);
});
