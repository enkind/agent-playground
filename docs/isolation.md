# How isolation works

The playground is a second Codex, with its own home, its own app profile, and its own threads, running next to your real one.

## Isolated

- **Codex home.** A fresh `CODEX_HOME` inside `~/.agent-playground/runs/<id>/h`: config, plugins, skills, threads, logs, databases, and the app-server socket.
- **App profile.** A separate Electron `--user-data-dir`, so windows, cookies, and UI state are separate and the two apps don't share a single-instance lock.
- **Credentials.** In `borrow` mode, the isolated home gets your access token and ID token but an empty refresh token. It can talk to the API until the access token expires, but it can never rotate your refresh token, so it can't log your main Codex out. In `login` mode it has a separate session of its own.
- **Your skills.** Codex also reads `~/.agents/skills` from your real home folder. Every skill found there is disabled in the playground with Codex's `skills.config` setting.
- **Files the agent touches.** Fixture threads run in `<run>/workspace`, a scratch folder (optionally seeded from `workspace.template`).

## Not isolated

- **Your filesystem.** The isolated agent follows Codex's normal sandbox rules. If you open a new chat and point it at a real project folder, it can edit that folder, just like your main Codex.
- **Your personal plugin marketplace.** `~/.agents/plugins/marketplace.json` still shows up as a marketplace source. Nothing from it is installed.
- **Deep links.** `codex://` links and MCP OAuth callbacks go to whichever ChatGPT app macOS routes them to, which may be your main one.
- **Your account.** The playground uses the same ChatGPT account and counts against the same usage limits.

## Global side effects, and how they're handled

On first launch, the desktop app normally installs its browser and computer-use integrations. The browser integration registers a native-messaging host **globally** for every Chromium-based browser it finds (observed: Chrome, Chromium, Edge, Opera, and Vivaldi), pointing at a program inside the current `CODEX_HOME`. If that happened in the playground, deleting the run folder would break your browser extension until your main Codex restarts.

agent-playground prevents this in three layers:

1. The isolated `config.toml` disables `browser_use_external`, `computer_use`, and the bundled `chrome` and `computer-use` plugins before the first launch. With this config, the manifests were verified to stay byte-identical.
2. The manifests are snapshotted before launch and restored after the app exits if any of them point into the run folder.
3. Run folders live in `~/.agent-playground/runs` (mode `0700`) rather than `/tmp`, so no other user can recreate a path a manifest points at.

`agent-playground doctor` reports any manifest that points into a removed run, and `doctor --fix` points it back at your real Codex home.

## Cleanup

When the app closes, or on Ctrl-C, `SIGTERM`, or `SIGHUP`, agent-playground:

1. Stops file watchers, the app, helper processes still bound to the run folder (such as Electron's crash reporter), and your services.
2. Restores browser manifests if needed.
3. Deletes the run folder, including the borrowed token.

If the process is killed hard, the next `dev` removes runs whose owner process is gone. `--keep` runs survive until `agent-playground clean`.
