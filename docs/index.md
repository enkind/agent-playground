# agent-playground

A disposable, isolated agent instance for developing plugins, skills, and MCP servers, running in the same desktop app your users use.

You run one command. agent-playground builds a brand-new agent home, installs your **collection** (plugins, skills, MCP servers), seeds your **fixtures** (ready-made conversation threads), starts your dev services, and launches the app against that home. Your own agent, with its threads, settings, and credentials, is never touched. When you close the app, the whole environment is deleted.

Supported today: **Codex** desktop on macOS.

## Quick start

Requirements: macOS, Node.js 20.12 or newer, the ChatGPT desktop app with Codex, and a signed-in Codex.

```sh
npm install --save-dev @enkind/agent-playground
npx @enkind/agent-playground init
```

Edit the generated `agent-playground.json`:

```json
{
  "agent": "codex",
  "collection": {
    "plugins": ["./plugins/my-plugin"],
    "skills": ["./skills/my-skill"]
  },
  "fixtures": ["./playground/fixtures"]
}
```

Then start the playground:

```sh
npx @enkind/agent-playground dev
```

A separate Codex window opens. Your fixtures appear under **Recents**, and your plugins and skills are installed. Edit a skill or a plugin file and it is reinstalled right away; start a new chat to pick up the change.

Add it to `package.json` so `npm run dev` does the same:

```json
{
  "scripts": {
    "dev": "agent-playground dev"
  }
}
```

## What happens on `dev`

1. Leftover runs from crashed sessions are removed.
2. Your `before` commands run (for example, a build).
3. A run folder is created in `~/.agent-playground/runs/`, readable only by you.
4. A fresh Codex home is created there. It is signed in with a borrowed access token, and your refresh token never leaves `~/.codex`.
5. Fixtures are imported as threads.
6. The collection is installed through the official Codex CLI.
7. Your `services` start (for example, your MCP dev server), and the app waits until they answer.
8. Codex launches against the isolated home.
9. When you close it, everything above is stopped and deleted.

## Commands

| Command | What it does |
| --- | --- |
| `agent-playground dev` | Build the playground and launch the app. |
| `agent-playground dev --dry-run` | Build everything, print what the isolated agent sees (threads, skills, MCP servers), then clean up. Useful in CI and for debugging a config. |
| `agent-playground dev --keep` | Keep the run folder after the app closes. |
| `agent-playground threads` | List your recent threads. |
| `agent-playground export <id \| last> --out <dir>` | Turn a thread into a scrubbed fixture. |
| `agent-playground doctor [--fix]` | Check the install, your sign-in, leftover runs, and browser manifests. |
| `agent-playground clean` | Delete every leftover run, including kept ones. |
| `agent-playground init` | Write a starter config. |

## Next

- [Collections](collections.html): plugins, skills, and MCP servers.
- [Fixtures](fixtures.html): the format and how to export them.
- [Configuration](configuration.html): every config key.
- [How isolation works](isolation.html): what is isolated and what isn't.
- [Security review](security-review.html): the workarounds, and why they are safe.
- [Adapters](adapters.html): adding support for another agent.
