import { mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { copyTree, exists } from "../../fs-utils.mjs";
import { run, stopProcess } from "../../process.mjs";
import { stringifyToml } from "../../toml.mjs";
import { withAppServer } from "./app-server.mjs";
import { borrowAuth, interactiveLogin } from "./auth.mjs";
import { restoreNativeHosts, snapshotNativeHosts } from "./native-hosts.mjs";
import { PluginStage } from "./plugins.mjs";
import { seedFixtures } from "./seed.mjs";
import { exportFixture, listThreads } from "./export.mjs";

const defaultApp = "/Applications/ChatGPT.app";
const maxSocketPathBytes = 103;

/** Bundled integrations that register global, cross-home state (browser native hosts, computer use). */
const globallyRegisteringBundledPlugins = ["chrome", "computer-use"];

export function resolveCodexPaths(options = {}) {
  const app = options.app ?? process.env.AGENT_PLAYGROUND_CODEX_APP ?? defaultApp;
  return {
    app,
    executable: path.join(app, "Contents", "MacOS", "ChatGPT"),
    cli: options.cli ?? process.env.AGENT_PLAYGROUND_CODEX_CLI ?? path.join(app, "Contents", "Resources", "codex"),
    sourceHome: process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex"),
  };
}

export const codexAdapter = {
  name: "codex",
  displayName: "Codex",

  async preflight(config) {
    if (process.platform !== "darwin") throw new Error("The Codex adapter currently supports macOS only.");
    const paths = resolveCodexPaths(config.agentOptions);
    if (!(await exists(paths.executable))) throw new Error(`Codex desktop app not found at ${paths.app}. Set "codex.app" in the config.`);
    if (!(await exists(paths.cli))) throw new Error(`Codex CLI not found at ${paths.cli}. Set "codex.cli" in the config.`);
  },

  createSession(context) {
    return new CodexSession(context);
  },

  exportFixture,
  listThreads,
};

class CodexSession {
  constructor({ config, runRoot, log, options }) {
    this.config = config;
    this.runRoot = runRoot;
    this.log = log;
    this.options = options;
    this.paths = resolveCodexPaths(config.agentOptions);
    this.codexHome = path.join(runRoot, "h");
    this.userData = path.join(runRoot, "e");
    this.workspace = path.join(runRoot, "workspace");
    this.env = { ...process.env, CODEX_HOME: this.codexHome };
    this.stage = new PluginStage({ runRoot, cli: this.paths.cli, env: this.env });
    this.nativeHostSnapshot = null;
    this.app = null;
  }

  async prepare() {
    const socketPath = path.join(this.codexHome, "ipc", "ipc.sock");
    if (Buffer.byteLength(socketPath) > maxSocketPathBytes) {
      throw new Error(`The run root path is too long for Codex's IPC socket (${socketPath}). Set AGENT_PLAYGROUND_HOME to a shorter directory.`);
    }
    await Promise.all([
      mkdir(this.codexHome, { mode: 0o700 }),
      mkdir(this.userData, { mode: 0o700 }),
    ]);
    if (this.config.workspace.template) await copyTree(this.config.workspace.template, this.workspace);
    else await mkdir(this.workspace);

    await writeFile(path.join(this.codexHome, "config.toml"), stringifyToml(await this.isolatedConfig()), { mode: 0o600 });

    if (this.config.auth === "login") {
      this.log.step("Signing the isolated instance in with its own Codex session...");
      await interactiveLogin({ cli: this.paths.cli, env: this.env });
    } else {
      const { expiresAt } = await borrowAuth({ sourceHome: this.paths.sourceHome, targetHome: this.codexHome });
      if (expiresAt) this.log.info(`Borrowed your Codex access token (valid until ${new Date(expiresAt).toLocaleString()}); your refresh token stays in ${this.paths.sourceHome}.`);
    }
  }

  async isolatedConfig() {
    const options = this.config.agentOptions;
    const bundledToDisable = [...globallyRegisteringBundledPlugins, ...(options.disableBundledPlugins ?? [])];
    const plugins = Object.fromEntries(bundledToDisable.map((name) => [`${name}@openai-bundled`, { enabled: false }]));

    const mcpServers = {};
    for (const [name, server] of Object.entries(this.config.collection.mcpServers)) {
      mcpServers[name] = server.url
        ? { url: server.url, bearer_token_env_var: server.bearerTokenEnvVar }
        : { command: server.command, args: server.args, env: Object.keys(server.env).length ? server.env : undefined, cwd: server.cwd };
    }

    const disabledUserSkills = (await listHomeSkills()).map((file) => ({ path: file, enabled: false }));

    const generated = {
      features: { browser_use_external: false, computer_use: false },
      plugins,
      mcp_servers: Object.keys(mcpServers).length ? mcpServers : undefined,
      skills: disabledUserSkills.length ? { config: disabledUserSkills } : undefined,
    };
    return deepMerge(generated, options.config ?? {});
  }

  async seed(fixtures) {
    return seedFixtures({
      fixtures,
      cli: this.paths.cli,
      env: this.env,
      codexHome: this.codexHome,
      workspace: this.workspace,
      home: homedir(),
    });
  }

  async installCollection() {
    const { plugins, skills } = this.config.collection;
    const watchTargets = [];

    for (const entry of plugins.filter((plugin) => plugin.kind === "local")) {
      const plugin = await this.stage.addLocal(entry);
      if (entry.watch) {
        watchTargets.push({
          path: entry.path,
          label: `plugin ${plugin.name}`,
          refresh: () => this.stage.refresh(plugin),
        });
      }
    }
    const installed = await this.stage.installLocal();
    for (const entry of plugins.filter((plugin) => plugin.kind === "marketplace")) {
      installed.push(await this.stage.installFromMarketplace(entry));
    }

    const skillNames = [];
    for (const skill of skills) {
      if (!(await exists(path.join(skill.path, "SKILL.md")))) throw new Error(`${skill.path} has no SKILL.md.`);
      const name = path.basename(skill.path);
      const destination = path.join(this.codexHome, "skills", name);
      await copyTree(skill.path, destination);
      skillNames.push(name);
      if (skill.watch) {
        watchTargets.push({ path: skill.path, label: `skill ${name}`, refresh: () => copyTree(skill.path, destination) });
      }
    }

    return {
      summary: [
        ...installed.map((plugin) => `plugin ${plugin.pluginId}`),
        ...skillNames.map((name) => `skill ${name}`),
        ...Object.keys(this.config.collection.mcpServers).map((name) => `MCP server ${name}`),
      ],
      watchTargets,
    };
  }

  /** What the isolated instance actually sees, straight from the official app-server API. */
  async inspect() {
    return withAppServer({ cli: this.paths.cli, env: this.env }, async ({ request }) => {
      const [skills, threads, mcp] = await Promise.all([
        request("skills/list", { cwds: [this.workspace] }),
        request("thread/list", {}),
        request("mcpServerStatus/list", {}).catch(() => null),
      ]);
      return {
        skills: skills.data?.[0]?.skills ?? [],
        threads: threads.data ?? [],
        mcpServers: (mcp?.data ?? []).map((server) => ({
          name: server.name,
          pluginId: server.pluginId,
          status: server.runtimeStatus?.type ?? server.runtimeStatus ?? null,
          tools: Object.keys(server.tools ?? {}).length,
        })),
      };
    });
  }

  async launch() {
    this.nativeHostSnapshot = await snapshotNativeHosts();
    const args = [`--user-data-dir=${this.userData}`];
    if (this.options.remoteDebuggingPort) args.push(`--remote-debugging-port=${this.options.remoteDebuggingPort}`);
    this.app = spawn(this.paths.executable, args, {
      env: { ...this.env, CODEX_ELECTRON_USER_DATA_PATH: this.userData },
      stdio: ["ignore", "ignore", "ignore"],
    });
    return new Promise((resolve, reject) => {
      this.app.once("error", reject);
      this.app.once("exit", (code) => resolve(code));
    });
  }

  async dispose() {
    await stopProcess(this.app);
    await stopProcessesReferencing(this.runRoot);
    if (this.nativeHostSnapshot) {
      const restored = await restoreNativeHosts(this.nativeHostSnapshot, this.runRoot);
      for (const file of restored) this.log.warn(`Restored browser native-host manifest ${file}`);
    }
  }
}

/** Helpers such as Electron's crashpad handler outlive the app; stop anything still bound to the run root. */
async function stopProcessesReferencing(runRoot) {
  let table;
  try {
    table = await run("ps", ["-axo", "pid=,command="]);
  } catch {
    return;
  }
  for (const line of table.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match || Number(match[1]) === process.pid || !match[2].includes(runRoot)) continue;
    try {
      process.kill(Number(match[1]), "SIGTERM");
    } catch {
      // Already exited.
    }
  }
}

async function listHomeSkills() {
  const root = path.join(homedir(), ".agents", "skills");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = new Set();
  for (const entry of entries) {
    const file = path.join(root, entry.name, "SKILL.md");
    if (!(await exists(file))) continue;
    files.add(file);
    files.add(await realpath(file));
  }
  return [...files];
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    const bothObjects = [current, value].every((item) => item && typeof item === "object" && !Array.isArray(item));
    result[key] = bothObjects ? deepMerge(current, value) : value;
  }
  return result;
}
