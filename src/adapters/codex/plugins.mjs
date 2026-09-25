import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyTree, exists } from "../../fs-utils.mjs";
import { run } from "../../process.mjs";

export const stagedMarketplaceName = "agent-playground";

/**
 * Local plugins are copied into `<run>/stage` and installed from a generated
 * marketplace with the official CLI. Overrides such as a local MCP URL are
 * applied to the staged copy, so neither your sources nor Codex's plugin cache
 * are edited by hand.
 */
export class PluginStage {
  constructor({ runRoot, cli, env }) {
    this.root = path.join(runRoot, "stage");
    this.cli = cli;
    this.env = env;
    this.local = [];
  }

  async addLocal(entry) {
    const manifestFile = path.join(entry.path, ".codex-plugin", "plugin.json");
    if (!(await exists(manifestFile))) {
      throw new Error(`${entry.path} is not a Codex plugin (missing .codex-plugin/plugin.json).`);
    }
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    if (typeof manifest.name !== "string" || !/^[A-Za-z0-9._-]+$/.test(manifest.name)) {
      throw new Error(`${manifestFile} needs a "name" made of letters, digits, ".", "_" or "-".`);
    }
    if (this.local.some((plugin) => plugin.name === manifest.name)) {
      throw new Error(`Two local plugins are named "${manifest.name}".`);
    }
    const plugin = { ...entry, name: manifest.name, category: manifest.interface?.category ?? "Productivity" };
    this.local.push(plugin);
    await this.stage(plugin);
    return plugin;
  }

  async stage(plugin) {
    const destination = path.join(this.root, "plugins", plugin.name);
    await copyTree(plugin.path, destination);
    if (plugin.mcpServers) await applyMcpOverride(destination, plugin.mcpServers);
  }

  async installLocal() {
    if (this.local.length === 0) return [];
    const marketplace = {
      name: stagedMarketplaceName,
      interface: { displayName: "Agent Playground" },
      plugins: this.local.map((plugin) => ({
        name: plugin.name,
        source: { source: "local", path: `./plugins/${plugin.name}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: plugin.category,
      })),
    };
    await mkdir(path.join(this.root, ".agents", "plugins"), { recursive: true });
    await writeFile(path.join(this.root, ".agents", "plugins", "marketplace.json"), `${JSON.stringify(marketplace, null, 2)}\n`);
    await run(this.cli, ["plugin", "marketplace", "add", this.root, "--json"], { env: this.env });
    const installed = [];
    for (const plugin of this.local) installed.push(await this.install(`${plugin.name}@${stagedMarketplaceName}`));
    return installed;
  }

  async installFromMarketplace(entry) {
    const added = JSON.parse(await run(this.cli, ["plugin", "marketplace", "add", entry.marketplace, "--json"], { env: this.env }));
    return this.install(`${entry.plugin}@${added.marketplaceName}`);
  }

  async install(pluginId) {
    return JSON.parse(await run(this.cli, ["plugin", "add", pluginId, "--json"], { env: this.env }));
  }

  /** Re-stages a local plugin from source and reinstalls it through the CLI. */
  async refresh(plugin) {
    await this.stage(plugin);
    return this.install(`${plugin.name}@${stagedMarketplaceName}`);
  }
}

async function applyMcpOverride(pluginDir, overrides) {
  const manifestFile = path.join(pluginDir, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  let servers = {};

  if (typeof manifest.mcpServers === "string") {
    const existing = path.resolve(pluginDir, manifest.mcpServers);
    if (await exists(existing)) servers = JSON.parse(await readFile(existing, "utf8")).mcpServers ?? {};
  } else if (manifest.mcpServers && typeof manifest.mcpServers === "object") {
    servers = manifest.mcpServers.mcpServers ?? manifest.mcpServers;
  }

  for (const [name, server] of Object.entries(overrides)) {
    if (server === null) delete servers[name];
    else servers[name] = server;
  }

  await writeFile(path.join(pluginDir, ".mcp.json"), `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
  if (manifest.mcpServers !== "./.mcp.json") {
    manifest.mcpServers = "./.mcp.json";
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
