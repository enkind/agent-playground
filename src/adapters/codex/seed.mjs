import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { substitute } from "../../fixtures.mjs";
import { run } from "../../process.mjs";
import { withAppServer } from "./app-server.mjs";

/**
 * Seeds fixtures as legacy rollout files and imports them with the official
 * `codex migrate-rollouts --apply`. Migration only succeeds in a home whose
 * thread store has not been created yet, so this must run before anything
 * else starts Codex against the home.
 */
export async function seedFixtures({ fixtures, cli, env, codexHome, workspace, home }) {
  if (fixtures.length === 0) return [];
  await assertFreshThreadStore(codexHome);

  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const dateParts = [now.getUTCFullYear(), pad(now.getUTCMonth() + 1), pad(now.getUTCDate())];
  const stamp = `${dateParts.join("-")}T${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;
  const sessionDir = path.join(codexHome, "sessions", ...dateParts.map(String));
  await mkdir(sessionDir, { recursive: true });

  for (const fixture of fixtures) {
    const lines = substitute(fixture.lines, {
      [fixture.placeholders.agentHome]: codexHome,
      [fixture.placeholders.cwd]: workspace,
      [fixture.placeholders.home]: home,
    }).map(asDesktopThread);
    const body = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
    await writeFile(path.join(sessionDir, `rollout-${stamp}-${fixture.threadId}.jsonl`), body);
  }

  const args = ["migrate-rollouts", "--apply", "--json"];
  for (const fixture of fixtures) args.push("--thread", fixture.threadId);
  let report;
  try {
    report = JSON.parse(await run(cli, args, { env }));
  } catch (error) {
    report = safeParse(error.stdout);
    if (!report) throw error;
  }
  const failures = (report.outcomes ?? []).filter((outcome) => outcome.status === "failed");
  if (failures.length > 0) {
    const details = failures.map((failure) => `  - ${failure.thread_id}: ${failure.failure_reason ?? failure.message}`).join("\n");
    throw new Error(`Codex could not import ${failures.length} fixture(s):\n${details}`);
  }

  await withAppServer({ cli, env }, async ({ request }) => {
    for (const fixture of fixtures) {
      await request("thread/name/set", { threadId: fixture.threadId, name: fixture.name });
    }
  });

  return fixtures;
}

/** The desktop app only lists interactive threads, so a thread recorded by `codex exec` is re-labelled. */
function asDesktopThread(line) {
  if (line.type !== "session_meta" || line.payload?.source !== "exec") return line;
  return { ...line, payload: { ...line.payload, source: "vscode", originator: "Codex Desktop" } };
}

async function assertFreshThreadStore(codexHome) {
  const entries = await readdir(codexHome);
  const store = entries.find((name) => /^(state|thread_history)_\d+\.sqlite$/.test(name));
  if (store) {
    throw new Error(`Fixtures must be seeded before Codex creates its thread store, but ${store} already exists.`);
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
