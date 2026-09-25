const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const log = {
  step(message) {
    console.log(`${paint("36", "›")} ${message}`);
  },
  info(message) {
    console.log(`  ${message}`);
  },
  ok(message) {
    console.log(`${paint("32", "✓")} ${message}`);
  },
  warn(message) {
    console.warn(`${paint("33", "!")} ${message}`);
  },
  error(message) {
    console.error(`${paint("31", "✗")} ${message}`);
  },
};
