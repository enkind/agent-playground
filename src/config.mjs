import { readFile } from "node:fs/promises";
import path from "node:path";

export const configFileName = "agent-playground.json";

const topLevelKeys = new Set(["$schema", "agent", "auth", "before", "services", "collection", "fixtures", "workspace", "codex"]);

/**
 * Loads and validates the project config. The config is plain JSON so loading
 * it never executes code. Every relative path is resolved against the config's
 * directory.
 */
export async function loadConfig(configPath) {
  const file = path.resolve(configPath ?? configFileName);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`No ${path.basename(file)} found in ${path.dirname(file)}. Run \`agent-playground init\` to create one.`);
    }
    throw error;
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
  return normalizeConfig(json, path.dirname(file), file);
}

export function normalizeConfig(json, baseDir, file = "config") {
  const problems = [];
  const fail = (message) => problems.push(message);
  const resolvePath = (value) => path.resolve(baseDir, value);

  if (!isObject(json)) throw new Error(`${file} must contain a JSON object.`);
  for (const key of Object.keys(json)) {
    if (!topLevelKeys.has(key)) fail(`Unknown key "${key}".`);
  }

  const agent = json.agent ?? "codex";
  if (typeof agent !== "string") fail(`"agent" must be a string.`);

  const auth = json.auth ?? "borrow";
  if (!["borrow", "login"].includes(auth)) fail(`"auth" must be "borrow" or "login".`);

  const before = asArray(json.before, "before", fail).map((entry, index) => {
    const step = typeof entry === "string" ? { command: entry } : entry;
    if (!isObject(step) || typeof step.command !== "string") {
      fail(`"before[${index}]" must be a command string or { "command": "..." }.`);
      return null;
    }
    return { command: step.command, cwd: resolvePath(step.cwd ?? "."), env: stringMap(step.env, `before[${index}].env`, fail) };
  });

  const services = asArray(json.services, "services", fail).map((entry, index) => {
    if (!isObject(entry) || typeof entry.command !== "string") {
      fail(`"services[${index}]" must be an object with a "command".`);
      return null;
    }
    if (entry.readyUrl !== undefined && typeof entry.readyUrl !== "string") fail(`"services[${index}].readyUrl" must be a string.`);
    return {
      name: typeof entry.name === "string" ? entry.name : `service-${index + 1}`,
      command: entry.command,
      cwd: resolvePath(entry.cwd ?? "."),
      env: stringMap(entry.env, `services[${index}].env`, fail),
      readyUrl: entry.readyUrl,
    };
  });

  const collectionJson = json.collection ?? {};
  if (!isObject(collectionJson)) fail(`"collection" must be an object.`);
  for (const key of Object.keys(collectionJson)) {
    if (!["plugins", "skills", "mcpServers"].includes(key)) fail(`Unknown key "collection.${key}".`);
  }

  const plugins = asArray(collectionJson.plugins, "collection.plugins", fail).map((entry, index) => {
    const where = `collection.plugins[${index}]`;
    if (typeof entry === "string") entry = { path: entry };
    if (!isObject(entry)) {
      fail(`"${where}" must be a path or an object.`);
      return null;
    }
    if (typeof entry.path === "string") {
      if (entry.mcpServers !== undefined && !isObject(entry.mcpServers)) fail(`"${where}.mcpServers" must be an object.`);
      return {
        kind: "local",
        path: resolvePath(entry.path),
        mcpServers: entry.mcpServers,
        watch: entry.watch ?? true,
      };
    }
    if (typeof entry.marketplace === "string" && typeof entry.plugin === "string") {
      const isLocalPath = entry.marketplace.startsWith(".") || entry.marketplace.startsWith("/");
      return {
        kind: "marketplace",
        marketplace: isLocalPath ? resolvePath(entry.marketplace) : entry.marketplace,
        plugin: entry.plugin,
      };
    }
    fail(`"${where}" needs either "path" or both "marketplace" and "plugin".`);
    return null;
  });

  const skills = asArray(collectionJson.skills, "collection.skills", fail).map((entry, index) => {
    const skill = typeof entry === "string" ? { path: entry } : entry;
    if (!isObject(skill) || typeof skill.path !== "string") {
      fail(`"collection.skills[${index}]" must be a path or { "path": "..." }.`);
      return null;
    }
    return { path: resolvePath(skill.path), watch: skill.watch ?? true };
  });

  const mcpServers = {};
  const mcpJson = collectionJson.mcpServers ?? {};
  if (!isObject(mcpJson)) fail(`"collection.mcpServers" must be an object.`);
  for (const [name, server] of Object.entries(mcpJson)) {
    const where = `collection.mcpServers.${name}`;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) fail(`"${where}": server names may only contain letters, digits, "_" and "-".`);
    if (!isObject(server)) {
      fail(`"${where}" must be an object.`);
      continue;
    }
    if (typeof server.url === "string") {
      mcpServers[name] = { url: server.url, bearerTokenEnvVar: server.bearerTokenEnvVar };
    } else if (typeof server.command === "string") {
      if (server.args !== undefined && !(Array.isArray(server.args) && server.args.every((arg) => typeof arg === "string"))) {
        fail(`"${where}.args" must be an array of strings.`);
      }
      mcpServers[name] = {
        command: server.command,
        args: server.args ?? [],
        env: stringMap(server.env, `${where}.env`, fail),
        cwd: server.cwd === undefined ? undefined : resolvePath(server.cwd),
      };
    } else {
      fail(`"${where}" needs a "url" (HTTP) or a "command" (stdio).`);
    }
  }

  const fixtures = asArray(json.fixtures, "fixtures", fail).map((entry, index) => {
    if (typeof entry !== "string") {
      fail(`"fixtures[${index}]" must be a path.`);
      return null;
    }
    return resolvePath(entry);
  });

  const workspaceJson = json.workspace ?? {};
  if (!isObject(workspaceJson)) fail(`"workspace" must be an object.`);
  const workspace = {
    template: typeof workspaceJson.template === "string" ? resolvePath(workspaceJson.template) : undefined,
  };

  const agentOptions = json[agent] ?? {};
  if (!isObject(agentOptions)) fail(`"${agent}" must be an object.`);

  if (problems.length > 0) {
    throw new Error(`Invalid ${file}:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  }

  return {
    file,
    baseDir,
    agent,
    auth,
    before: before.filter(Boolean),
    services: services.filter(Boolean),
    collection: {
      plugins: plugins.filter(Boolean),
      skills: skills.filter(Boolean),
      mcpServers,
    },
    fixtures: fixtures.filter(Boolean),
    workspace,
    agentOptions,
  };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value, name, fail) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fail(`"${name}" must be an array.`);
    return [];
  }
  return value;
}

function stringMap(value, name, fail) {
  if (value === undefined) return {};
  if (!isObject(value) || !Object.values(value).every((item) => typeof item === "string")) {
    fail(`"${name}" must be an object of string values.`);
    return {};
  }
  return value;
}
