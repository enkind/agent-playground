# agent-playground

A disposable, isolated agent instance for developing plugins, skills, and MCP servers, running in the same app your users use.

`agent-playground dev` builds a fresh agent home, installs a predefined **collection** (plugins, skills, MCP servers), seeds predefined **fixtures** (ready-made conversation threads), and launches the desktop app against it. Your own agent setup, threads, and credentials stay untouched. Closing the app removes everything.

Codex (macOS desktop app) is supported today. The adapter layer is built so other agents can be added.

```sh
npm install --save-dev github:enkind/agent-playground
npx agent-playground init
npx agent-playground dev
```

```json
{
  "agent": "codex",
  "collection": {
    "plugins": [
      {
        "path": "./plugins/my-plugin",
        "mcpServers": { "main": { "type": "http", "url": "http://127.0.0.1:3100/mcp" } }
      }
    ],
    "skills": ["./skills/my-skill"],
    "mcpServers": { "time": { "command": "node", "args": ["./mcp/time.mjs"] } }
  },
  "fixtures": ["./playground/fixtures"]
}
```

Turn a real thread into a fixture:

```sh
npx agent-playground threads
npx agent-playground export <thread-id> --out playground/fixtures/my-scenario
```

Documentation: [agent-playground docs](https://agent-playground-docs.vercel.app). The [security review](docs/security-review.md) explains every workaround and why it is safe.

## Development

```sh
npm test                 # unit tests
npm run docs:build       # builds docs/dist
node bin/agent-playground.mjs dev --dry-run --config examples/basic/agent-playground.json
```

## License

MIT
