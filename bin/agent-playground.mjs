#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (error) => {
    console.error(`agent-playground: ${error.message}`);
    if (process.env.AGENT_PLAYGROUND_DEBUG) console.error(error.stack);
    process.exitCode = 1;
  },
);
