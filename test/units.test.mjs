import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exportFixture } from "../src/adapters/codex/export.mjs";
import { jwtExpiry } from "../src/adapters/codex/auth.mjs";
import { normalizeConfig } from "../src/config.mjs";
import { loadFixtures, substitute } from "../src/fixtures.mjs";
import { scanForSecrets } from "../src/secrets.mjs";
import { stringifyToml } from "../src/toml.mjs";

test("stringifyToml writes nested tables, quoted keys, and arrays of tables", () => {
  const toml = stringifyToml({
    features: { computer_use: false },
    plugins: { "chrome@openai-bundled": { enabled: false } },
    mcp_servers: { time: { command: "node", args: ["a b.mjs"], env: { KEY: "v\"x" } } },
    skills: { config: [{ path: "/Users/me/.agents/skills/x/SKILL.md", enabled: false }] },
  });
  assert.equal(
    toml,
    [
      "[features]",
      "computer_use = false",
      "",
      '[plugins."chrome@openai-bundled"]',
      "enabled = false",
      "",
      "[mcp_servers.time]",
      'command = "node"',
      'args = ["a b.mjs"]',
      "",
      "[mcp_servers.time.env]",
      'KEY = "v\\"x"',
      "",
      "[[skills.config]]",
      'path = "/Users/me/.agents/skills/x/SKILL.md"',
      "enabled = false",
      "",
    ].join("\n"),
  );
});

test("substitute replaces placeholders inside parsed values without breaking JSON", () => {
  const hostile = '/Users/o"brien\\dir';
  const result = substitute([{ cwd: "__CWD__", text: "run in __CWD__/x", nested: [{ "__CWD__": 1 }] }], { __CWD__: hostile });
  const roundTrip = JSON.parse(JSON.stringify(result));
  assert.equal(roundTrip[0].cwd, hostile);
  assert.equal(roundTrip[0].text, `run in ${hostile}/x`);
  assert.deepEqual(Object.keys(roundTrip[0].nested[0]), [hostile]);
});

test("normalizeConfig resolves paths and rejects unknown keys", () => {
  const config = normalizeConfig(
    {
      collection: {
        plugins: ["./p", { marketplace: "owner/repo", plugin: "x" }, { marketplace: "./m", plugin: "y" }],
        skills: ["./s"],
        mcpServers: { http: { url: "http://127.0.0.1:1/mcp" }, stdio: { command: "node", args: ["x"] } },
      },
      fixtures: ["./f"],
    },
    "/repo",
  );
  assert.equal(config.agent, "codex");
  assert.equal(config.auth, "borrow");
  assert.equal(config.collection.plugins[0].path, "/repo/p");
  assert.equal(config.collection.plugins[1].marketplace, "owner/repo");
  assert.equal(config.collection.plugins[2].marketplace, "/repo/m");
  assert.equal(config.collection.skills[0].path, "/repo/s");
  assert.deepEqual(config.fixtures, ["/repo/f"]);

  assert.throws(() => normalizeConfig({ colection: {} }, "/repo"), /Unknown key "colection"/);
  assert.throws(() => normalizeConfig({ auth: "copy" }, "/repo"), /"auth" must be/);
  assert.throws(() => normalizeConfig({ collection: { mcpServers: { "bad name": { url: "x" } } } }, "/repo"), /server names/);
});

test("scanForSecrets flags credentials and public IPs but not localhost or versions", () => {
  const findings = scanForSecrets([
    { text: "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl" },
    { text: "ssh root@203.0.113.7" },
    { text: "server on http://127.0.0.1:3100 and 10.0.0.4, version 1.2.3.4" },
    { text: "key sk-proj-abcdefghijklmnopqrstuvwxyz0123" },
  ]);
  const kinds = findings.map((finding) => `${finding.line}:${finding.kind}`);
  assert.ok(kinds.includes("1:JWT"));
  assert.ok(kinds.includes("2:IP address"));
  assert.ok(kinds.includes("4:OpenAI API key"));
  assert.ok(!kinds.some((kind) => kind.startsWith("3:")), `unexpected findings on line 3: ${kinds}`);
  assert.ok(findings.every((finding) => !finding.preview.includes("203.0.113.7")));
});

test("jwtExpiry reads the exp claim", () => {
  const payload = Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString("base64url");
  assert.equal(jwtExpiry(`x.${payload}.y`), 2_000_000_000_000);
  assert.equal(jwtExpiry("not-a-jwt"), null);
});

test("exportFixture scrubs paths, reasoning, developer messages, and usage, then round-trips through loadFixtures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ap-test-"));
  const home = path.join(root, "codex-home");
  const cwd = path.join(homedir(), "Projects", "demo");
  const id = "01a0da0e-c1f5-7372-b53e-5aaba27e2429";
  await mkdir(path.join(home, "sessions", "2026", "09", "25"), { recursive: true });
  const lines = [
    { type: "session_meta", payload: { id, cwd, source: "vscode", git: { repository_url: "git@github.com:me/secret.git" } } },
    { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "rules: ssh root@203.0.113.7" }] } },
    { type: "turn_context", payload: { cwd, cyber_access_program: true } },
    { type: "event_msg", payload: { type: "user_message", message: `look at ${cwd}/src and ${home}/skills` } },
    { type: "response_item", payload: { type: "reasoning", encrypted_content: "gAAAA" } },
    { type: "event_msg", payload: { type: "item_completed", item: { type: "Reasoning" } } },
    { type: "event_msg", payload: { type: "token_count", rate_limits: {} } },
    { type: "world_state", payload: {} },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] } },
  ];
  await writeFile(
    path.join(home, "sessions", "2026", "09", "25", `rollout-2026-09-25T10-00-00-${id}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n"),
  );

  const out = path.join(root, "fixture");
  const result = await exportFixture({ threadId: id, out, name: "Demo", from: home });
  assert.deepEqual(result.removed, { reasoning: 2, developer: 1, usage: 1, other: 1 });

  const written = await readFile(path.join(out, "rollout.jsonl"), "utf8");
  assert.ok(!written.includes(homedir()), "home directory leaked");
  assert.ok(!written.includes("203.0.113.7"), "developer rules leaked");
  assert.ok(!written.includes("secret.git"), "git metadata leaked");
  assert.ok(!written.includes("cyber_access_program"));
  assert.ok(written.includes("look at __CWD__/src and __CODEX_HOME__/skills"));

  const [fixture] = await loadFixtures([out]);
  assert.equal(fixture.threadId, id);
  assert.equal(fixture.name, "Demo");
  assert.equal(fixture.lines.length, 4);

  await assert.rejects(exportFixture({ threadId: id, out, from: home }), /already contains a fixture/);
});

test("exportFixture refuses to write when the scrubbed transcript still has findings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ap-test-"));
  const id = "01a0da0e-0000-7372-b53e-5aaba27e2429";
  await mkdir(path.join(root, "sessions"), { recursive: true });
  await writeFile(
    path.join(root, "sessions", `rollout-x-${id}.jsonl`),
    [
      JSON.stringify({ type: "session_meta", payload: { id, cwd: "/w" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "my key is sk-abcdefghijklmnopqrstuvwxyz012345" } }),
    ].join("\n"),
  );
  await assert.rejects(exportFixture({ threadId: id, out: path.join(root, "f"), from: root }), (error) => {
    assert.equal(error.findings[0].kind, "OpenAI API key");
    return true;
  });
  const result = await exportFixture({ threadId: id, out: path.join(root, "f"), from: root, allowFindings: true });
  assert.equal(result.findings.length, 1);
});
