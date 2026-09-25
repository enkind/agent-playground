import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { exists } from "../../fs-utils.mjs";
import { fixtureFileName, placeholders, substitute } from "../../fixtures.mjs";
import { scanForSecrets } from "../../secrets.mjs";

const defaultSourceHome = () => process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");

/**
 * Lists recent threads from a Codex home by reading its files directly. It never
 * starts Codex against that home.
 */
export async function listThreads({ from = defaultSourceHome(), limit = 20 } = {}) {
  const names = await readSessionIndex(from);
  const files = await findRollouts(from);
  const withTimes = await Promise.all(files.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })));
  withTimes.sort((a, b) => b.mtime - a.mtime);

  const threads = [];
  for (const { file, mtime } of withTimes.slice(0, limit)) {
    const id = threadIdFromFile(file);
    const firstUserMessage = await readFirstUserMessage(file);
    threads.push({ id, name: names.get(id) ?? null, preview: firstUserMessage, updatedAt: new Date(mtime), file });
  }
  return threads;
}

/**
 * Turns one real thread into a committable fixture: machine paths become
 * placeholders, and content that is private, account-bound, or irrelevant to
 * replaying the conversation is removed before a final secret scan.
 */
export async function exportFixture({
  threadId,
  out,
  name,
  description,
  from = defaultSourceHome(),
  keepReasoning = false,
  keepDeveloperMessages = false,
  allowFindings = false,
  force = false,
}) {
  const files = await findRollouts(from);
  const file = threadId === "last" ? await newest(files) : files.find((candidate) => threadIdFromFile(candidate) === threadId);
  if (!file) throw new Error(`No rollout for thread ${threadId} in ${from}.`);

  const lines = (await readFile(file, "utf8"))
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const sessionMeta = lines.find((line) => line.type === "session_meta");
  if (!sessionMeta) throw new Error(`${file} has no session_meta line.`);
  const id = sessionMeta.payload.id;
  const cwd = sessionMeta.payload.cwd;

  const removed = { reasoning: 0, developer: 0, usage: 0, other: 0 };
  const kept = [];
  for (const line of lines) {
    const verdict = classify(line, { keepReasoning, keepDeveloperMessages });
    if (verdict === "keep") kept.push(scrubLine(line));
    else removed[verdict] += 1;
  }

  const replacements = {};
  const addReplacement = (value, token) => {
    if (!value || value === "/" || replacements[value]) return;
    replacements[value] = token;
    if (value.startsWith("/private/")) replacements[value.slice("/private".length)] ??= token;
    else if (value.startsWith("/tmp/") || value.startsWith("/var/")) replacements[`/private${value}`] ??= token;
  };
  addReplacement(cwd, placeholders.cwd);
  addReplacement(from, placeholders.agentHome);
  addReplacement(homedir(), placeholders.home);
  // Longest paths first so a cwd inside the home directory becomes __CWD__, not __HOME__/...
  const ordered = Object.fromEntries(Object.entries(replacements).sort(([a], [b]) => b.length - a.length));
  const scrubbed = substitute(kept, ordered);

  const findings = scanForSecrets(scrubbed);
  if (findings.length > 0 && !allowFindings) {
    const error = new Error(
      `Refusing to write the fixture: the scrubbed transcript still contains ${findings.length} possible secret(s) or personal detail(s). Review them, then pass --allow-findings to write anyway.`,
    );
    error.findings = findings;
    throw error;
  }

  const fixtureName = name ?? (await readSessionIndex(from)).get(id) ?? (await readFirstUserMessage(file))?.slice(0, 60) ?? id;
  if ((await exists(path.join(out, fixtureFileName))) && !force) {
    throw new Error(`${out} already contains a fixture. Pass --force to overwrite it.`);
  }
  await mkdir(out, { recursive: true });
  await writeFile(
    path.join(out, fixtureFileName),
    `${JSON.stringify({ agent: "codex", name: fixtureName, description, threadId: id, transcript: "rollout.jsonl" }, null, 2)}\n`,
  );
  await writeFile(path.join(out, "rollout.jsonl"), `${scrubbed.map((line) => JSON.stringify(line)).join("\n")}\n`);

  return { out, threadId: id, name: fixtureName, source: file, removed, findings, lines: scrubbed.length };
}

function classify(line, { keepReasoning, keepDeveloperMessages }) {
  const payload = line.payload ?? {};
  if (line.type === "world_state") return "other";
  if (line.type === "token_usage_record") return "usage";
  if (line.type === "event_msg" && payload.type === "token_count") return "usage";
  if (!keepReasoning) {
    if (line.type === "response_item" && payload.type === "reasoning") return "reasoning";
    if (line.type === "event_msg" && payload.type === "item_completed" && payload.item?.type === "Reasoning") return "reasoning";
    if (line.type === "event_msg" && /reasoning/i.test(payload.type ?? "")) return "reasoning";
  }
  if (!keepDeveloperMessages && line.type === "response_item" && payload.type === "message" && payload.role === "developer") {
    return "developer";
  }
  return "keep";
}

function scrubLine(line) {
  if (line.type === "session_meta") {
    const { git, dynamic_tools, ...payload } = line.payload;
    return { ...line, payload };
  }
  if (line.type === "turn_context") {
    const { cyber_access_program, user_instructions, developer_instructions, ...payload } = line.payload;
    return { ...line, payload };
  }
  return line;
}

async function findRollouts(home) {
  const files = [];
  for (const dir of ["sessions", "archived_sessions"]) {
    const root = path.join(home, dir);
    if (!(await exists(root))) continue;
    for (const entry of await readdir(root, { recursive: true })) {
      if (/rollout-.*\.jsonl$/.test(entry)) files.push(path.join(root, entry));
    }
  }
  return files;
}

async function newest(files) {
  let best = null;
  for (const file of files) {
    const mtime = (await stat(file)).mtimeMs;
    if (!best || mtime > best.mtime) best = { file, mtime };
  }
  return best?.file;
}

function threadIdFromFile(file) {
  const match = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
  return match?.[1] ?? null;
}

async function readSessionIndex(home) {
  const names = new Map();
  try {
    for (const line of (await readFile(path.join(home, "session_index.jsonl"), "utf8")).split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      if (entry.id && entry.thread_name) names.set(entry.id, entry.thread_name);
    }
  } catch {
    // No index: names fall back to the first message.
  }
  return names;
}

async function readFirstUserMessage(file) {
  const text = await readFile(file, "utf8");
  for (const line of text.split("\n")) {
    if (!line.includes('"user_message"') && !line.includes('"UserMessage"')) continue;
    try {
      const payload = JSON.parse(line).payload;
      const message = payload.message ?? payload.item?.content?.find?.((part) => part.text)?.text;
      if (typeof message === "string") return message.replace(/\s+/g, " ").trim().slice(0, 120);
    } catch {
      // Skip malformed lines.
    }
  }
  return null;
}
