import { watch } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { getAdapter } from "./adapters/index.mjs";
import { resolveCodexPaths } from "./adapters/codex/index.mjs";
import { jwtExpiry } from "./adapters/codex/auth.mjs";
import { findManifestsPointingInto } from "./adapters/codex/native-hosts.mjs";
import { configFileName, loadConfig } from "./config.mjs";
import { loadFixtures } from "./fixtures.mjs";
import { exists } from "./fs-utils.mjs";
import { log } from "./log.mjs";
import { run, runShell, startShell, stopProcess, waitForUrl } from "./process.mjs";
import { createRunRoot, listRuns, markKept, runsRoot, sweepStaleRuns } from "./run-root.mjs";

const usage = `agent-playground: an isolated, disposable agent instance for developing plugins, skills, and MCP servers.

Usage:
  agent-playground dev [--config <file>] [--keep] [--dry-run] [--remote-debugging-port <port>]
  agent-playground threads [--from <codex home>] [--limit <n>]
  agent-playground export <thread-id | last> --out <dir> [--name <name>] [--description <text>]
                          [--from <codex home>] [--keep-reasoning] [--keep-developer-messages]
                          [--allow-findings] [--force]
  agent-playground doctor [--fix]
  agent-playground clean
  agent-playground init

Commands:
  dev       Build a fresh isolated agent home with your collection and fixtures, then launch it.
            Closing the app removes everything again.
  threads   List recent threads you can export as fixtures.
  export    Turn a real thread into a scrubbed, committable fixture.
  doctor    Check the agent install, your sign-in, leftover runs, and global side effects.
  clean     Remove leftover runs, including ones kept with --keep.
  init      Write a starter ${configFileName}.
`;

export async function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case "dev":
      return dev(rest);
    case "threads":
      return threads(rest);
    case "export":
      return exportCommand(rest);
    case "doctor":
      return doctor(rest);
    case "clean":
      return clean();
    case "init":
      return init();
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(usage);
      return 0;
    default:
      console.error(`Unknown command "${command}".\n\n${usage}`);
      return 1;
  }
}

async function dev(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string", short: "c" },
      keep: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "remote-debugging-port": { type: "string" },
    },
  });

  const config = await loadConfig(values.config);
  const adapter = getAdapter(config.agent);
  await adapter.preflight(config);
  const fixtures = (await loadFixtures(config.fixtures)).filter((fixture) => fixture.agent === adapter.name);

  const swept = await sweepStaleRuns();
  if (swept.length > 0) log.info(`Removed ${swept.length} leftover run(s) from earlier sessions.`);

  for (const step of config.before) {
    log.step(`Running ${step.command}`);
    await runShell(step.command, { cwd: step.cwd, env: { ...process.env, ...step.env } });
  }

  const runRoot = await createRunRoot();
  const services = [];
  const watchers = [];
  let session;
  let cleaning = null;

  const cleanup = () => {
    cleaning ??= (async () => {
      for (const watcher of watchers) watcher.close();
      if (session) await session.dispose().catch((error) => log.error(`Cleanup: ${error.message}`));
      await Promise.all(services.map((service) => stopProcess(service)));
      if (values.keep) {
        await markKept(runRoot);
        log.info(`Kept the run at ${runRoot}. Remove it with \`agent-playground clean\`.`);
      } else {
        await rm(runRoot, { recursive: true, force: true });
        log.ok("Removed the isolated environment.");
      }
    })();
    return cleaning;
  };

  const onSignal = (signal) => {
    log.warn(`Received ${signal}, cleaning up...`);
    cleanup("signal").finally(() => process.exit(130));
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, onSignal);

  try {
    session = adapter.createSession({
      config,
      runRoot,
      log,
      options: { remoteDebuggingPort: values["remote-debugging-port"] },
    });

    log.step(`Creating an isolated ${adapter.displayName} home in ${runRoot}`);
    await session.prepare();

    if (fixtures.length > 0) {
      log.step(`Seeding ${fixtures.length} fixture(s)`);
      await session.seed(fixtures);
      for (const fixture of fixtures) log.info(`${fixture.name}`);
    }

    log.step("Installing the collection");
    const { summary, watchTargets } = await session.installCollection();
    for (const line of summary) log.info(line);
    if (summary.length === 0) log.info("(empty collection)");

    if (values["dry-run"]) {
      const seen = await session.inspect();
      console.log(JSON.stringify(
        {
          runRoot,
          threads: seen.threads.map((thread) => ({ id: thread.id, name: thread.name, cwd: thread.cwd })),
          skills: seen.skills.map((skill) => ({ name: skill.name, scope: skill.scope, enabled: skill.enabled, path: skill.path })),
          mcpServers: seen.mcpServers,
        },
        null,
        2,
      ));
      await cleanup("done");
      return 0;
    }

    for (const service of config.services) {
      log.step(`Starting ${service.name}: ${service.command}`);
      const child = startShell(service.command, { cwd: service.cwd, env: { ...process.env, ...service.env } });
      services.push(child);
      if (service.readyUrl) await waitForUrl(service.readyUrl, { child });
    }

    let queue = Promise.resolve();
    for (const target of watchTargets) {
      let timer = null;
      const watcher = watch(target.path, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          queue = queue
            .then(() => target.refresh())
            .then(() => log.ok(`Updated ${target.label}. Start a new chat to pick it up.`))
            .catch((error) => log.error(`Could not update ${target.label}: ${error.message}`));
        }, 250);
      });
      watchers.push(watcher);
    }

    log.step(`Launching ${adapter.displayName}. Close the app to end the session.`);
    await session.launch();
    await queue;
    await cleanup("done");
    return 0;
  } catch (error) {
    await cleanup("error");
    throw error;
  } finally {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(signal, onSignal);
  }
}

async function threads(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { from: { type: "string" }, limit: { type: "string", default: "20" }, agent: { type: "string", default: "codex" } },
  });
  const adapter = getAdapter(values.agent);
  const list = await adapter.listThreads({ from: values.from, limit: Number(values.limit) });
  for (const thread of list) {
    console.log(`${thread.id}  ${thread.updatedAt.toISOString().slice(0, 16).replace("T", " ")}  ${thread.name ?? thread.preview ?? ""}`);
  }
  if (list.length === 0) console.log("No threads found.");
  return 0;
}

async function exportCommand(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      name: { type: "string" },
      description: { type: "string" },
      from: { type: "string" },
      agent: { type: "string", default: "codex" },
      "keep-reasoning": { type: "boolean", default: false },
      "keep-developer-messages": { type: "boolean", default: false },
      "allow-findings": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  });
  const [threadId] = positionals;
  if (!threadId || !values.out) {
    console.error("Usage: agent-playground export <thread-id | last> --out <dir>");
    return 1;
  }
  const adapter = getAdapter(values.agent);
  try {
    const result = await adapter.exportFixture({
      threadId,
      out: path.resolve(values.out),
      name: values.name,
      description: values.description,
      from: values.from,
      keepReasoning: values["keep-reasoning"],
      keepDeveloperMessages: values["keep-developer-messages"],
      allowFindings: values["allow-findings"],
      force: values.force,
    });
    log.ok(`Exported "${result.name}" (${result.threadId}) to ${result.out}`);
    log.info(
      `Removed ${result.removed.reasoning} reasoning, ${result.removed.developer} developer, ${result.removed.usage} usage, and ${result.removed.other} other line(s).`,
    );
    for (const finding of result.findings) log.warn(`line ${finding.line}: ${finding.kind} ${finding.preview}`);
    log.info("Read the transcript before committing it; the scrubber is a safety net, not a guarantee.");
    return 0;
  } catch (error) {
    if (!error.findings) throw error;
    log.error(error.message);
    for (const finding of error.findings) log.warn(`line ${finding.line}: ${finding.kind} ${finding.preview}`);
    return 1;
  }
}

async function doctor(argv) {
  const { values } = parseArgs({ args: argv, options: { fix: { type: "boolean", default: false } } });
  let problems = 0;
  const paths = resolveCodexPaths();

  if (await exists(paths.executable)) log.ok(`Codex desktop app: ${paths.app}`);
  else {
    problems += 1;
    log.error(`Codex desktop app not found at ${paths.app}`);
  }
  if (await exists(paths.cli)) log.ok(`Codex CLI: ${(await run(paths.cli, ["--version"])).trim()}`);
  else {
    problems += 1;
    log.error(`Codex CLI not found at ${paths.cli}`);
  }

  try {
    const auth = JSON.parse(await readFile(path.join(paths.sourceHome, "auth.json"), "utf8"));
    const expiry = auth.tokens?.access_token ? jwtExpiry(auth.tokens.access_token) : null;
    if (expiry && expiry < Date.now()) {
      problems += 1;
      log.error("Your Codex access token has expired. Open Codex once so it refreshes.");
    } else {
      log.ok(`Signed in (${auth.auth_mode ?? "unknown mode"}${expiry ? `, access token valid until ${new Date(expiry).toLocaleString()}` : ""})`);
    }
  } catch {
    log.warn(`No readable ${path.join(paths.sourceHome, "auth.json")}; "auth": "borrow" won't work, use "auth": "login".`);
  }

  const runs = await listRuns();
  const active = runs.filter((entry) => entry.active);
  const leftover = runs.filter((entry) => !entry.active);
  log.ok(`${active.length} active run(s), ${leftover.length} leftover run(s)${leftover.length ? " (run `agent-playground clean`)" : ""}`);

  const manifests = await findManifestsPointingInto(runsRoot());
  for (const manifest of manifests) {
    const runDir = path.relative(runsRoot(), manifest.hostPath).split(path.sep)[0];
    const runActive = active.some((entry) => path.basename(entry.root) === runDir);
    if (runActive) {
      log.warn(`${manifest.file} points into active run ${runDir}; it will be restored when that run ends.`);
      continue;
    }
    problems += 1;
    const homePrefix = path.join(runsRoot(), runDir, "h") + path.sep;
    const repaired = manifest.hostPath.startsWith(homePrefix)
      ? path.join(paths.sourceHome, manifest.hostPath.slice(homePrefix.length))
      : null;
    if (values.fix && repaired && (await exists(repaired))) {
      const text = await readFile(manifest.file, "utf8");
      const json = JSON.parse(text);
      json.path = repaired;
      await writeFile(manifest.file, `${JSON.stringify(json, null, 2)}\n`);
      log.ok(`Repointed ${manifest.file} at ${repaired}`);
    } else {
      log.error(`${manifest.file} points into a removed run (${manifest.hostPath}).${repaired ? " Run `agent-playground doctor --fix`, or restart your main Codex." : " Restart your main Codex to rewrite it."}`);
    }
  }
  if (manifests.length === 0) log.ok("No browser native-host manifests point into agent-playground runs");

  return problems === 0 ? 0 : 1;
}

async function clean() {
  const removed = await sweepStaleRuns({ includeKept: true });
  log.ok(`Removed ${removed.length} run(s).`);
  return 0;
}

async function init() {
  const file = path.resolve(configFileName);
  if (await exists(file)) {
    log.error(`${configFileName} already exists.`);
    return 1;
  }
  const starter = {
    $schema: "https://raw.githubusercontent.com/enkind/agent-playground/main/schema/config.schema.json",
    agent: "codex",
    collection: {
      plugins: [],
      skills: [],
      mcpServers: {},
    },
    fixtures: [],
  };
  await writeFile(file, `${JSON.stringify(starter, null, 2)}\n`);
  log.ok(`Wrote ${configFileName}`);
  return 0;
}
