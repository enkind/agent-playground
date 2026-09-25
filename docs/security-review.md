# Security and robustness review

This review covers the isolated-Codex workflow that `agent-playground` was extracted from (`better-response/scripts/dev-codex.mjs`). Each workaround was tested against Codex desktop `26.917.71314` / CLI `0.155.0-alpha.16.4` on macOS. Every finding lists what was observed, whether it is a real problem, and what `agent-playground` does instead.

## Summary

| Workaround | Verdict | What agent-playground does |
| --- | --- | --- |
| Temp `CODEX_HOME` under `/tmp` | Acceptable, one hardening fix | Run roots live in `~/.agent-playground/runs/<id>` (mode `0700`) |
| Copy `~/.codex/auth.json` into the temp home | **Real problem** | Borrow only the access and ID tokens; the refresh token never leaves `~/.codex` |
| Launch with a separate `--user-data-dir` | **Real problem** (global side effects) | Disable the bundled browser/computer-use integrations, guard and restore browser native-host manifests |
| `codex plugin marketplace add` + `codex plugin add` | Fine (official CLI) | Kept |
| Overwrite `.mcp.json` inside `plugins/cache/...` | Hacky | Stage a copy of the plugin, apply overrides to the copy, install the copy with the official CLI |
| Copy `SKILL.md` into the plugin cache on change | Hacky | Re-stage and re-run `codex plugin add` (≈15 ms) |
| Write rollout JSONL + `session_index.jsonl`, then `codex migrate-rollouts --apply` | Acceptable (official migration path) with two bugs | Kept, with JSON-aware placeholder substitution and the official `thread/name/set` API instead of `session_index.jsonl` |
| Write `.codex-global-state.json` (Electron internal state) | Hacky and unnecessary | Removed; seeded threads appear in Recents without it |
| Fixture threads run in `~/Documents/Codex` | Real risk | Each run gets a scratch workspace inside the run root |
| Committed fixtures | **Real problem** (data leak) | `agent-playground export` scrubs paths, reasoning blobs, permissions/rules, and usage data, then scans for secrets |
| Isolation of skills | **Real leak** | `~/.agents/skills/*` are disabled in the isolated home through the official `skills.config` setting |
| No signal handling | Robustness | Cleanup on `SIGINT`/`SIGTERM`/`SIGHUP`, stale-run sweeping on the next start |

## Findings

### 1. Copying `auth.json` puts your main session at risk

`~/.codex/auth.json` contains `id_token`, `access_token`, `refresh_token`, and `account_id`. The original script copies the whole file into the isolated home. Two Codex homes then hold the **same refresh token**. ChatGPT refresh tokens rotate: whichever instance refreshes first invalidates the other copy, and reuse of a rotated token can revoke the whole token family. The likely failure is that your *main* Codex gets logged out at a random moment, days after a playground session.

A second, smaller issue: if the script was interrupted (Ctrl-C before the app launched, or a crash while it ran), the preserved temp directory kept a long-lived refresh token on disk.

**Tested alternatives.**

- `codex login --with-access-token` only accepts "agent identity" JWTs; a ChatGPT access token is rejected (`agent identity JWT payload is not valid JSON`).
- Writing an isolated `auth.json` that carries `id_token`, `access_token`, and `account_id` but an **empty `refresh_token`** works: `codex login status` reports "Logged in using ChatGPT", a real `codex exec` turn succeeds, the desktop app signs in, and neither `auth.json` is modified.

**What agent-playground does.** The default `auth: "borrow"` mode copies only the short-lived tokens (the file is created with `O_EXCL` and mode `0600`). It checks the access token's `exp` claim and refuses to start if the token has expired or expires within an hour; opening your main Codex refreshes it. The isolated instance cannot rotate your refresh token because it never has it. `auth: "login"` runs the official `codex login` inside the isolated home for a completely separate session.

### 2. The isolated desktop app rewrites global browser manifests

On first launch, the desktop app installs its bundled `chrome` and `computer-use` plugins into `CODEX_HOME` and registers a Chrome native-messaging host. That registration is **global**, not per `CODEX_HOME`: it rewrote `com.openai.codexextension.json` for Chrome, Chromium, Edge, Opera, and Vivaldi to point at `/private/tmp/<run>/h/plugins/cache/openai-bundled/chrome/.../ChatGPT for Chrome`.

After the run directory is deleted:

- The ChatGPT browser extension for your main Codex is broken until the main app is restarted (it rewrites the manifests on launch).
- The manifest points at a path under the world-writable `/tmp`. Another local user could recreate that directory and place an executable there; the browser would run it as you when the extension connects. This is a local privilege-escalation primitive.

The same run also copied `Codex Computer Use.app` into the isolated home and registered it as a `notify` hook in the isolated `config.toml`.

**What agent-playground does.**

- The isolated `config.toml` is written *before* the first launch with `features.browser_use_external = false`, `features.computer_use = false`, and the bundled `chrome@openai-bundled` / `computer-use@openai-bundled` plugins disabled. With this config the manifests stayed byte-identical during a full launch.
- As a safety net, the manifests are snapshotted before launch and restored after the app exits if any of them points into the run root.
- Run roots live under `~/.agent-playground/runs/` (owned by you, mode `0700`) instead of `/tmp`, so a dangling path can never be claimed by another user. The Unix-socket length limit (`$CODEX_HOME/ipc/ipc.sock`, about 104 bytes on macOS) is checked explicitly.

The other bundled plugins (`codex-app-tools`, `visualize`, `browser`) stay enabled by default because the point is to test where users are. Note that Codex ships its own bundled `visualize` plugin; you can disable bundled plugins per project with `codex.disableBundledPlugins`.

### 3. Editing the plugin cache

The original script overwrote `plugins/cache/<marketplace>/<plugin>/<version>/.mcp.json` to point the plugin at the local dev server, and hot-reloaded skills by copying `SKILL.md` into the same cache directory. The cache layout is an implementation detail. Any reinstall silently reverts the change, and a version bump changes the path.

`codex plugin add` on an already-installed local plugin refreshes the cache from source in about 15 ms, which makes cache editing unnecessary.

**What agent-playground does.** Each plugin is copied into `<run>/stage/plugins/<name>`. Overrides (for example, replacing `mcpServers` with a local URL) are applied to that copy. A generated `agent-playground` marketplace lists the staged plugins and is installed with `codex plugin marketplace add` and `codex plugin add`. On file changes the plugin is re-staged and re-added through the same official commands.

### 4. Seeding threads

The seeding path is: write a rollout JSONL into `sessions/YYYY/MM/DD/`, then run the official `codex migrate-rollouts --apply`, Codex's own migration from legacy sessions into its paginated thread store. That is a supported import path, so it is kept.

Alternatives that were ruled out:

- `thread/start` + `thread/inject_items` (app-server API) only adds model-visible history. The UI shows no turns and the thread is not listed.
- `externalAgentConfig/import` with `SESSIONS` imports other agents' sessions from their own files, so it does not fit.

Problems found and fixed:

- **Ordering.** Migration only works in a fresh home. After the app (or `app-server`) has created its SQLite state, migration fails with `missing_sqlite_metadata`. agent-playground always seeds first, in a brand-new home, before anything else touches it.
- **Raw string replacement.** Placeholders were replaced with `String.replaceAll` on raw JSON text. A path containing `"` or `\` would corrupt the JSON, or inject fields. Substitution now happens on parsed values and is re-serialized.
- **`session_index.jsonl`** was hand-written for thread names. The official `thread/name/set` app-server call is used instead.
- **`.codex-global-state.json`** (Electron internal UI state: projectless thread IDs, onboarding flags) is not needed. Seeded threads appear in Recents and onboarding did not block a fresh profile. It was removed.

### 5. Fixture threads ran against a real directory

Seeded threads used `~/Documents/Codex` as their working directory. Continuing a fixture thread gives the isolated agent workspace-write access to that real folder. The Codex state is isolated, but the filesystem is not.

**What agent-playground does.** Each run creates `<run>/workspace` and uses it as `__CWD__` for all fixtures. You can seed it from a template directory with `workspace.template`.

### 6. Committed fixtures leak personal data

The committed `better-response` fixtures contain:

- Developer instructions with your approved command rules, including an `ssh root@<address> ...` rule that reveals a real server's IP address and host name.
- Your skill roots and permission profile.
- 30 `encrypted_content` reasoning blobs. These are opaque, but they are tied to the account that produced them, so another account may not be able to continue the thread.
- `token_count` events with rate-limit data.

**What agent-playground does.** `agent-playground export` replaces your cwd, `CODEX_HOME`, and home directory with placeholders, removes reasoning items, developer messages, git metadata, `world_state`, `token_count`, and `token_usage_record`, and then scans the result for JWTs, API keys, emails, and IP addresses. It refuses to write if it finds something unless you pass `--allow-findings`. **Action for you:** the `better-response` fixtures should be re-exported, and the IP address is already in that repository's public git history.

### 7. Skills leak into the isolated instance

The isolated instance's `skills/list` included `~/.agents/skills/find-skills` from your real home (user scope). Codex reads `~/.agents/skills` from `$HOME`, not `$CODEX_HOME`.

**What agent-playground does.** Every `SKILL.md` under `~/.agents/skills` is disabled in the isolated `config.toml` with `[[skills.config]] path = "..." enabled = false`, which is the official setting. Verified through `skills/list`. Your personal marketplace (`~/.agents/plugins/marketplace.json`) also appears as a marketplace source; nothing from it is installed. This is listed as a known limitation.

### 8. Everything else

- **Process spawning** uses argument arrays (`spawn` without a shell) for everything agent-playground itself runs. Commands in `services` and `before` come from your config file, run through your shell, and are trusted the same way `npm` scripts are.
- **The config file is JSON**, so loading it never executes code.
- **No runtime dependencies**, so nothing can be compromised through the supply chain at runtime.
- **Cleanup**: on exit or signal, the app and services are stopped, the manifest guard runs, and the run root is deleted. The next start sweeps runs whose owning process is gone. Pass `--keep` to preserve a run for debugging.
- **Local MCP servers** you point plugins at are your own dev servers. Bind them to `127.0.0.1`, not `0.0.0.0`.
- **Deep links / OAuth callbacks** (`codex://`) are registered by whichever ChatGPT instance macOS picks. An MCP OAuth flow started in the isolated instance may land in your main one. This is a known limitation, not a vulnerability.
- **Fixtures are prompt input.** A fixture from an untrusted source is untrusted prompt content, so treat third-party fixtures like third-party code.
