# Adapters

Everything agent-specific lives in an adapter under `src/adapters/<agent>/`. The rest (config, fixtures loading, run folders, services, watching, cleanup, the CLI) is shared.

## The contract

```js
export const myAdapter = {
  name: "my-agent",           // the value of "agent" in the config
  displayName: "My Agent",

  async preflight(config) {}, // throw a readable error if the agent isn't installed

  createSession({ config, runRoot, log, options }) {
    return {
      async prepare() {},            // create the isolated home inside runRoot, sign it in
      async seed(fixtures) {},       // import fixtures as threads (runs before anything else)
      async installCollection() {    // plugins, skills, MCP servers
        return { summary: [], watchTargets: [{ path, label, refresh }] };
      },
      async inspect() {},            // what the isolated instance sees: { threads, skills, mcpServers }
      async launch() {},             // start the app; resolve when the user closes it
      async dispose() {},            // stop the app, undo global side effects
    };
  },

  async listThreads({ from, limit }) {},
  async exportFixture({ threadId, out, name, from, ... }) {},
};
```

Register it in `src/adapters/index.mjs`, and add a key for its options (like `codex`) to `src/config.mjs` and the schema.

## Rules the Codex adapter follows

These are the lessons from the [security review](security-review.html). A new adapter should hold to them too:

- Prefer the agent's official CLI and APIs over writing its internal files.
- Never copy long-lived credentials that the agent rotates.
- Keep everything inside `runRoot`, and give it owner-only permissions.
- Find out what the app writes *outside* its home on first launch, then prevent it or undo it in `dispose()`.
- Disable anything the agent loads from your real home folder.
- `inspect()` should report what the agent itself says it loaded, not what you think you installed.

## Cursor

Cursor is the obvious next adapter. `better-response/scripts/dev-cursor.mjs` is a starting point: it launches Cursor with a separate `--user-data-dir` and `--extensions-dir`. That script syncs plugins into the real `~/.cursor/plugins/local`, which is not isolated, and would need an isolated equivalent first.
