# Collections

A collection is the set of plugins, skills, and MCP servers that every playground run starts with. It lives under `collection` in `agent-playground.json`.

```json
{
  "collection": {
    "plugins": [],
    "skills": [],
    "mcpServers": {}
  }
}
```

## Plugins

### A plugin folder in your repo

Point at a folder containing `.codex-plugin/plugin.json`:

```json
{ "plugins": ["./plugins/my-plugin"] }
```

The folder is copied into the run folder and installed with `codex plugin marketplace add` and `codex plugin add`. Your source is never modified, and Codex's plugin cache is never edited by hand.

When a file in the folder changes, the plugin is copied and reinstalled again. Start a new chat to pick up the change. Set `"watch": false` to turn this off.

### Pointing a plugin at a local MCP server

Plugins usually ship with a production MCP URL. `mcpServers` replaces servers by name in the staged copy only:

```json
{
  "plugins": [
    {
      "path": "./plugins/better-response/dist",
      "mcpServers": {
        "visualize": { "type": "http", "url": "http://127.0.0.1:3100/api/mcp" }
      }
    }
  ]
}
```

Set a server to `null` to remove it from the staged copy.

### A plugin from a marketplace

```json
{ "plugins": [{ "marketplace": "owner/repo", "plugin": "plugin-name" }] }
```

`marketplace` is anything `codex plugin marketplace add` accepts: a local path or a Git source.

## Skills

Point at folders containing `SKILL.md`:

```json
{ "skills": ["./skills/release-notes"] }
```

Each one is copied into the isolated home's `skills/` folder and recopied when it changes.

Skills from your real `~/.agents/skills` are **disabled** in the playground, so what you see is only what's in your collection plus Codex's built-in system skills.

## MCP servers

Standalone MCP servers, written into the isolated `config.toml`:

```json
{
  "mcpServers": {
    "docs": { "url": "http://127.0.0.1:4000/mcp", "bearerTokenEnvVar": "DOCS_TOKEN" },
    "time": { "command": "node", "args": ["./mcp/time-server.mjs"], "cwd": ".", "env": { "TZ": "UTC" } }
  }
}
```

Relative `cwd` values are resolved against the config file.

## Running your dev server alongside

When a plugin talks to an MCP server you are developing, start it with `services`. The app launches only after `readyUrl` answers:

```json
{
  "before": ["pnpm build:mcp-app"],
  "services": [
    {
      "name": "web",
      "command": "pnpm --filter web dev",
      "env": { "PORT": "3100" },
      "readyUrl": "http://127.0.0.1:3100"
    }
  ]
}
```

`before` and `services` run through your shell, like `npm` scripts. Services are stopped when the app closes.

## Bundled Codex plugins

Codex installs its own bundled plugins into every home. agent-playground always disables `chrome` and `computer-use`, because they register global state outside the isolated home (see [How isolation works](isolation.html)). The rest stay on because that's what your users have. To turn more off:

```json
{ "codex": { "disableBundledPlugins": ["visualize"] } }
```
