import { spawn } from "node:child_process";
import readline from "node:readline";

/**
 * A short-lived `codex app-server` over stdio, used for the official
 * JSON-RPC API (thread names, skill and plugin listings).
 */
export async function withAppServer({ cli, env }, callback) {
  const child = spawn(cli, ["app-server"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  let exitError = null;

  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || !pending.has(message.id)) return;
    const { resolve, reject, method } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${method}: ${message.error.message ?? JSON.stringify(message.error)}`));
    else resolve(message.result);
  });

  child.once("exit", (code) => {
    exitError = new Error(`codex app-server exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`);
    for (const { reject } of pending.values()) reject(exitError);
    pending.clear();
  });

  const request = (method, params = {}) => {
    if (exitError) return Promise.reject(exitError);
    const id = ++nextId;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30_000).unref();
    });
  };

  try {
    await request("initialize", { clientInfo: { name: "agent-playground", version: "0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);
    return await callback({ request });
  } finally {
    child.stdin.end();
    child.kill("SIGTERM");
  }
}
