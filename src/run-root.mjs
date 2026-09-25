import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isAlive } from "./process.mjs";

export function stateRoot() {
  return process.env.AGENT_PLAYGROUND_HOME || path.join(homedir(), ".agent-playground");
}

export function runsRoot() {
  return path.join(stateRoot(), "runs");
}

/**
 * Creates `~/.agent-playground/runs/<id>` with owner-only permissions. Run roots
 * never live in a world-writable directory such as /tmp, so any path an agent
 * registers globally can't be recreated by another user after cleanup.
 */
export async function createRunRoot() {
  await mkdir(runsRoot(), { recursive: true, mode: 0o700 });
  await chmod(stateRoot(), 0o700);
  await chmod(runsRoot(), 0o700);
  const root = await realpath(await mkdtemp(path.join(runsRoot(), "r")));
  await chmod(root, 0o700);
  await writeFile(path.join(root, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return root;
}

export async function listRuns() {
  let entries = [];
  try {
    entries = await readdir(runsRoot(), { withFileTypes: true });
  } catch {
    return [];
  }
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(runsRoot(), entry.name);
    let owner = null;
    try {
      owner = JSON.parse(await readFile(path.join(root, "owner.json"), "utf8"));
    } catch {
      // Missing or partial owner file: treat as stale.
    }
    runs.push({ root, owner, active: Boolean(owner?.pid && isAlive(owner.pid)) });
  }
  return runs;
}

export async function markKept(root) {
  const file = path.join(root, "owner.json");
  const owner = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...owner, kept: true }));
}

/** Removes runs whose owning process is gone. Runs kept with `--keep` survive unless `includeKept`. */
export async function sweepStaleRuns({ includeKept = false } = {}) {
  const removed = [];
  for (const run of await listRuns()) {
    if (run.active || (run.owner?.kept && !includeKept)) continue;
    await rm(run.root, { recursive: true, force: true });
    removed.push(run.root);
  }
  return removed;
}
