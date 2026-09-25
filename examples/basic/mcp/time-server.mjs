#!/usr/bin/env node
// A dependency-free stdio MCP server with a single `current_time` tool.
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

lines.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = request;
  if (id === undefined) return;

  if (method === "initialize") {
    send({
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "playground-time", version: "0.1.0" },
      },
    });
  } else if (method === "tools/list") {
    send({
      id,
      result: {
        tools: [
          {
            name: "current_time",
            description: "Returns the current time as an ISO 8601 string.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
  } else if (method === "tools/call" && params?.name === "current_time") {
    send({ id, result: { content: [{ type: "text", text: new Date().toISOString() }] } });
  } else {
    send({ id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
});
