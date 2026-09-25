/**
 * Minimal TOML serializer for the config shapes Codex uses: nested tables,
 * arrays of tables, and primitive or primitive-array values.
 */
export function stringifyToml(object) {
  const lines = [];
  writeTable(lines, [], object);
  return `${lines.join("\n").replace(/^\n+/, "")}\n`;
}

function writeTable(lines, keyPath, table) {
  const scalars = [];
  const tables = [];
  const tableArrays = [];

  for (const [key, value] of Object.entries(table)) {
    if (value === undefined || value === null) continue;
    if (isPlainObject(value)) tables.push([key, value]);
    else if (Array.isArray(value) && value.length > 0 && value.every(isPlainObject)) tableArrays.push([key, value]);
    else scalars.push([key, value]);
  }

  if (keyPath.length > 0 && (scalars.length > 0 || (tables.length === 0 && tableArrays.length === 0))) {
    lines.push("", `[${keyPath.map(formatKey).join(".")}]`);
  }
  for (const [key, value] of scalars) lines.push(`${formatKey(key)} = ${formatValue(value)}`);
  for (const [key, value] of tables) writeTable(lines, [...keyPath, key], value);
  for (const [key, entries] of tableArrays) {
    for (const entry of entries) {
      lines.push("", `[[${[...keyPath, key].map(formatKey).join(".")}]]`);
      for (const [innerKey, innerValue] of Object.entries(entry)) {
        if (isPlainObject(innerValue) || (Array.isArray(innerValue) && innerValue.some(isPlainObject))) {
          throw new Error(`Nested tables inside [[${key}]] are not supported.`);
        }
        if (innerValue !== undefined && innerValue !== null) {
          lines.push(`${formatKey(innerKey)} = ${formatValue(innerValue)}`);
        }
      }
    }
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function formatValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot write ${value} to TOML.`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  throw new Error(`Unsupported TOML value: ${JSON.stringify(value)}`);
}
