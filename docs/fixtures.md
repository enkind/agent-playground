# Fixtures

A fixture is a conversation thread that is already there when the playground opens. Use one to reproduce the exact state you want to test, for example "the agent just produced a long table" before you invoke your skill.

## Format

A fixture is a folder with two files:

```text
playground/fixtures/beef-shopping/
  fixture.json
  rollout.jsonl
```

`fixture.json`:

```json
{
  "agent": "codex",
  "name": "Create beef steak shopping list",
  "description": "Starting point for checklist acceptance",
  "threadId": "01a06c2d-291e-7bf1-8824-6b9b184c021c",
  "transcript": "rollout.jsonl"
}
```

- `name` becomes the thread title in the sidebar.
- `threadId` must be unique across your fixtures. When it's missing, it is read from the transcript.
- `rollout.jsonl` is a Codex session transcript. Machine-specific paths are written as placeholders:
  - `__CWD__`: the playground's scratch workspace.
  - `__CODEX_HOME__`: the isolated Codex home.
  - `__HOME__`: your home directory.

List fixtures in the config, either one folder at a time or a parent folder of fixture folders:

```json
{ "fixtures": ["./playground/fixtures"] }
```

Folders that use the older `meta.json` format from `better-response` keep working.

## Creating fixtures from real threads

Have the conversation you want in Codex, then:

```sh
npx @enkind/agent-playground threads
```

```text
01a0da0e-c1f5-7372-b53e-5aaba27e2429  2026-09-25 19:33  Weekend hiking packing list
```

```sh
npx @enkind/agent-playground export 01a0da0e-c1f5-7372-b53e-5aaba27e2429 \
  --out playground/fixtures/hiking \
  --name "Weekend hiking packing list"
```

Use `last` instead of an id to export the most recent thread. `--from <codex home>` reads from a different Codex home.

Exporting only reads files. It never starts Codex against your home.

### What the exporter removes

Transcripts contain much more than the visible conversation. Before writing, the exporter:

- Replaces the thread's working directory, your Codex home, and your home directory with placeholders.
- Removes **reasoning** items. They are encrypted for your account and may fail when someone else continues the thread. `--keep-reasoning` keeps them.
- Removes **developer messages**. They include your approved command rules, skill roots, and permission profile. `--keep-developer-messages` keeps them. Continuing a fixture thread still works without them: Codex adds fresh instructions on the next turn.
- Removes `world_state`, `token_count`, and `token_usage_record` lines (rate limits, usage).
- Drops git metadata (`repository_url`, branch, commit) and account flags.

It then scans the result for JWTs, API keys, GitHub/Slack/AWS tokens, private keys, bearer tokens, email addresses, and public IP addresses. If anything is found, nothing is written and the findings are listed. Pass `--allow-findings` once you've checked them.

The scrubber is a safety net, not a guarantee. Read a transcript before committing it, especially the tool call outputs.

## How fixtures are imported

Fixtures are written as Codex session files and imported with the official `codex migrate-rollouts --apply`, then named through the app-server API. Import only works in a brand-new home, which is why fixtures are seeded before anything else runs. Each run's fixtures work in a scratch workspace inside the run folder, so continuing a fixture thread can't write to your real files.

Threads that were recorded with `codex exec` are shown as desktop threads, because the desktop app hides `exec` threads.

## Treat fixtures like code

A fixture is prompt input. A fixture from someone else can contain instructions aimed at the agent, so review third-party fixtures the way you review third-party code.
