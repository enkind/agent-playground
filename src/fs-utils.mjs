import { constants } from "node:fs";
import { access, cp, mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const skippedNames = new Set([".git", "node_modules", ".DS_Store"]);

export async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** Replaces `destination` with a fresh copy of `source`, skipping VCS and dependency folders. */
export async function copyTree(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    filter: (file) => !skippedNames.has(path.basename(file)),
  });
}

/** Creates a file that must not already exist, with owner-only permissions. */
export async function writeSecretFile(file, contents) {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
}

export async function writeFileAtomic(file, contents, mode) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, mode === undefined ? undefined : { mode });
  await rename(temporary, file);
}

export function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
