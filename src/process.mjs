import { spawn } from "node:child_process";

/**
 * Runs a program with an argument array (never through a shell) and resolves
 * with its captured stdout. Rejects with stderr attached on non-zero exit.
 */
export function run(command, args, { cwd, env, input, inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: inherit ? ["ignore", "inherit", "inherit"] : ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (!inherit) {
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
    }
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) return resolve(stdout);
      const reason = signal ? `was killed by ${signal}` : `exited with code ${code}`;
      const error = new Error(`${command} ${args.join(" ")} ${reason}${stderr ? `\n${stderr.trim()}` : ""}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

/**
 * Runs a command line from the user's config through their shell. These are
 * trusted the same way npm scripts are: they come from the project's own config.
 */
export function runShell(commandLine, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandLine, { cwd, env, shell: true, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`"${commandLine}" ${signal ? `was killed by ${signal}` : `exited with code ${code}`}`));
    });
  });
}

export function startShell(commandLine, { cwd, env } = {}) {
  return spawn(commandLine, { cwd, env, shell: true, stdio: "inherit", detached: true });
}

export async function stopProcess(child, { graceMs = 5000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  signalTree(child, "SIGTERM");
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise((resolve) => setTimeout(() => resolve(true), graceMs)),
  ]);
  if (timedOut) {
    signalTree(child, "SIGKILL");
    await exited;
  }
}

function signalTree(child, signal) {
  try {
    // Services are started detached, so the negative pid reaches the whole group
    // (for example `pnpm` and the dev server it spawns).
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

export async function waitForUrl(url, { child, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`Service exited with code ${child.exitCode} before ${url} was ready.`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${url}.`);
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
