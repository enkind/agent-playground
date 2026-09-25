import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { exists } from "./fs-utils.mjs";

export const fixtureFileName = "fixture.json";
const legacyFixtureFileName = "meta.json";

export const placeholders = {
  cwd: "__CWD__",
  agentHome: "__CODEX_HOME__",
  home: "__HOME__",
};

/**
 * Resolves each configured entry to fixture directories. An entry can be a
 * fixture directory itself or a folder whose subdirectories are fixtures.
 */
export async function loadFixtures(entries) {
  const fixtures = [];
  for (const entry of entries) {
    if (await isFixtureDir(entry)) {
      fixtures.push(await readFixture(entry));
      continue;
    }
    let children;
    try {
      children = await readdir(entry, { withFileTypes: true });
    } catch {
      throw new Error(`Fixture path ${entry} does not exist.`);
    }
    const dirs = children.filter((child) => child.isDirectory()).map((child) => path.join(entry, child.name)).sort();
    let found = 0;
    for (const dir of dirs) {
      if (!(await isFixtureDir(dir))) continue;
      fixtures.push(await readFixture(dir));
      found += 1;
    }
    if (found === 0) throw new Error(`No fixtures found in ${entry}. A fixture is a folder with ${fixtureFileName} and a transcript.`);
  }

  const seen = new Map();
  for (const fixture of fixtures) {
    if (seen.has(fixture.threadId)) {
      throw new Error(`Fixtures ${seen.get(fixture.threadId)} and ${fixture.dir} share thread id ${fixture.threadId}.`);
    }
    seen.set(fixture.threadId, fixture.dir);
  }
  return fixtures;
}

async function isFixtureDir(dir) {
  return (await exists(path.join(dir, fixtureFileName))) || (await exists(path.join(dir, legacyFixtureFileName)));
}

async function readFixture(dir) {
  const legacy = !(await exists(path.join(dir, fixtureFileName)));
  const meta = JSON.parse(await readFile(path.join(dir, legacy ? legacyFixtureFileName : fixtureFileName), "utf8"));
  const transcriptFile = path.join(dir, meta.transcript ?? "rollout.jsonl");
  const lines = (await readFile(transcriptFile, "utf8"))
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${transcriptFile}:${index + 1} is not valid JSON: ${error.message}`);
      }
    });

  const sessionMeta = lines.find((line) => line.type === "session_meta");
  const threadId = meta.threadId ?? sessionMeta?.payload?.id;
  if (!threadId) throw new Error(`${dir}: could not determine the thread id.`);

  return {
    dir,
    agent: meta.agent ?? "codex",
    threadId,
    name: meta.name ?? meta.threadName ?? path.basename(dir),
    description: meta.description,
    placeholders: {
      cwd: meta.cwdPlaceholder ?? placeholders.cwd,
      agentHome: meta.codexHomePlaceholder ?? placeholders.agentHome,
      home: placeholders.home,
    },
    lines,
  };
}

/**
 * Replaces placeholder tokens inside every string (and key) of a parsed value.
 * Working on parsed values instead of raw JSON text means a path containing
 * quotes or backslashes can't corrupt the transcript or inject fields.
 */
export function substitute(value, replacements) {
  const pairs = Object.entries(replacements).filter(([token]) => token);
  const replaceString = (text) => pairs.reduce((result, [token, replacement]) => result.split(token).join(replacement), text);
  const walk = (item) => {
    if (typeof item === "string") return replaceString(item);
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, inner]) => [replaceString(key), walk(inner)]));
    }
    return item;
  };
  return walk(value);
}
