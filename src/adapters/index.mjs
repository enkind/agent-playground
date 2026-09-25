import { codexAdapter } from "./codex/index.mjs";

/**
 * An adapter connects agent-playground to one agent product. It must provide:
 *
 * - `name`, `displayName`
 * - `preflight(config)`: throw a readable error if the agent isn't installed or usable.
 * - `createSession({ config, runRoot, log, options })`, returning a session with:
 *     - `prepare()`: create the isolated agent home inside `runRoot` and sign it in.
 *     - `seed(fixtures)`: import fixtures as threads. Runs before anything else
 *       touches the agent's state.
 *     - `installCollection()`: install plugins, skills, and MCP servers. Returns
 *       `{ summary: string[], watchTargets: { path, label, refresh() }[] }`.
 *     - `inspect()`: report what the isolated instance sees (skills, threads, ...).
 *     - `launch()`: start the app; resolves when the user closes it.
 *     - `dispose()`: stop the app and undo any global side effects.
 * - `exportFixture(options)` and `listThreads(options)`: turn real threads into fixtures.
 *
 * A Cursor adapter would live next to `codex/` and register here.
 */
const adapters = new Map([[codexAdapter.name, codexAdapter]]);

export function getAdapter(name) {
  const adapter = adapters.get(name);
  if (!adapter) {
    throw new Error(`Unknown agent "${name}". Available: ${[...adapters.keys()].join(", ")}.`);
  }
  return adapter;
}
