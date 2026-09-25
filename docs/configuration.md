# Configuration

agent-playground reads `agent-playground.json` from the current directory, or the file given with `--config`. It is plain JSON (loading it never runs code), and every relative path is resolved against the file's folder.

Add the schema for editor completion:

```json
{ "$schema": "./node_modules/agent-playground/schema/config.schema.json" }
```

## Full example

```json
{
  "agent": "codex",
  "auth": "borrow",
  "before": ["pnpm build:mcp-app"],
  "services": [
    {
      "name": "web",
      "command": "pnpm --filter web dev",
      "cwd": ".",
      "env": { "PORT": "3100" },
      "readyUrl": "http://127.0.0.1:3100"
    }
  ],
  "collection": {
    "plugins": [
      {
        "path": "./plugins/my-plugin/dist",
        "mcpServers": { "main": { "type": "http", "url": "http://127.0.0.1:3100/api/mcp" } },
        "watch": true
      },
      { "marketplace": "owner/repo", "plugin": "other-plugin" }
    ],
    "skills": ["./skills/my-skill", { "path": "./skills/other", "watch": false }],
    "mcpServers": {
      "docs": { "url": "http://127.0.0.1:4000/mcp" },
      "time": { "command": "node", "args": ["./mcp/time.mjs"], "env": { "TZ": "UTC" } }
    }
  },
  "fixtures": ["./playground/fixtures"],
  "workspace": { "template": "./playground/workspace" },
  "codex": {
    "app": "/Applications/ChatGPT.app",
    "disableBundledPlugins": ["visualize"],
    "config": { "model_reasoning_effort": "low" }
  }
}
```

## Keys

| Key | Default | Description |
| --- | --- | --- |
| `agent` | `"codex"` | Which agent adapter to use. |
| `auth` | `"borrow"` | `"borrow"` gives the playground your current access token, without the refresh token. `"login"` runs `codex login` in the isolated home on every run for a completely separate session. |
| `before` | `[]` | Commands that must succeed first. Strings, or `{ "command", "cwd", "env" }`. |
| `services` | `[]` | Long-running processes started before the app launches and stopped when it closes. `readyUrl` delays the launch until that URL answers. |
| `collection.plugins` | `[]` | See [Collections](collections.html#plugins). |
| `collection.skills` | `[]` | See [Collections](collections.html#skills). |
| `collection.mcpServers` | `{}` | See [Collections](collections.html#mcp-servers). |
| `fixtures` | `[]` | Fixture folders, or parents of fixture folders. See [Fixtures](fixtures.html). |
| `workspace.template` | none | A folder copied into the scratch workspace that fixture threads run in. |
| `codex.app` | `/Applications/ChatGPT.app` | Where the desktop app is installed. |
| `codex.cli` | the app's bundled `codex` | A different Codex CLI binary. |
| `codex.disableBundledPlugins` | `[]` | Bundled plugins to switch off, in addition to `chrome` and `computer-use`. |
| `codex.config` | `{}` | Merged into the isolated `config.toml`, for any Codex setting. |

## Environment variables

| Variable | Description |
| --- | --- |
| `AGENT_PLAYGROUND_HOME` | Where run folders live (default `~/.agent-playground`). Keep it short: Codex's IPC socket path must fit in about 104 bytes. |
| `AGENT_PLAYGROUND_CODEX_APP` | Same as `codex.app`. |
| `AGENT_PLAYGROUND_CODEX_CLI` | Same as `codex.cli`. |
| `CODEX_HOME` | Where your real Codex home is (the source for borrowed auth and `export`). |
| `AGENT_PLAYGROUND_DEBUG` | Print stack traces on errors. |

## Flags for `dev`

| Flag | Description |
| --- | --- |
| `--config <file>` | Use a different config file. |
| `--dry-run` | Build everything, print what the isolated agent sees, clean up. Doesn't start services or the app. |
| `--keep` | Keep the run folder when the app closes. It still contains a borrowed access token; `agent-playground clean` removes it. |
| `--remote-debugging-port <port>` | Launch the app with Chrome DevTools Protocol enabled on localhost, for UI automation. Any local process can control the app through this port while it's open, so only use it when you need it. |
