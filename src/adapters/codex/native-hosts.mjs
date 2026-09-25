import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { exists, isInside } from "../../fs-utils.mjs";

const browserDirs = [
  "Google/Chrome",
  "Google/Chrome Beta",
  "Google/Chrome Canary",
  "Chromium",
  "Microsoft Edge",
  "BraveSoftware/Brave-Browser",
  "Vivaldi",
  "com.operasoftware.Opera",
  "Arc/User Data",
];

/**
 * The desktop app registers browser native-messaging hosts globally, not per
 * CODEX_HOME. agent-playground disables the integrations that do this, and this
 * guard is the safety net: it snapshots the manifests before launch and puts
 * back any that ended up pointing into the run root.
 */
export async function snapshotNativeHosts() {
  const snapshot = new Map();
  for (const file of await listManifestFiles()) {
    snapshot.set(file, await readFile(file, "utf8"));
  }
  return snapshot;
}

export async function restoreNativeHosts(snapshot, runRoot) {
  const restored = [];
  for (const file of await listManifestFiles()) {
    const current = await readFile(file, "utf8");
    if (!pointsInto(current, runRoot)) continue;
    if (snapshot.has(file)) await writeFile(file, snapshot.get(file));
    else await rm(file, { force: true });
    restored.push(file);
  }
  return restored;
}

/** Manifests that point into any agent-playground run root, for `doctor`. */
export async function findManifestsPointingInto(root) {
  const matches = [];
  for (const file of await listManifestFiles()) {
    const current = await readFile(file, "utf8");
    if (pointsInto(current, root)) matches.push({ file, hostPath: manifestPath(current) });
  }
  return matches;
}

function pointsInto(manifestText, root) {
  const hostPath = manifestPath(manifestText);
  if (!hostPath) return false;
  return isInside(hostPath, root) || isInside(hostPath, path.join("/private", root));
}

function manifestPath(manifestText) {
  try {
    return JSON.parse(manifestText).path ?? null;
  } catch {
    return null;
  }
}

async function listManifestFiles() {
  const support = path.join(homedir(), "Library", "Application Support");
  const files = [];
  for (const dir of browserDirs) {
    const hostsDir = path.join(support, dir, "NativeMessagingHosts");
    if (!(await exists(hostsDir))) continue;
    for (const name of await readdir(hostsDir)) {
      if (name.startsWith("com.openai.") && name.endsWith(".json")) files.push(path.join(hostsDir, name));
    }
  }
  return files;
}
