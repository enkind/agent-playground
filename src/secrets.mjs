const detectors = [
  { kind: "JWT", pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: "OpenAI API key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { kind: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: "bearer token", pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  { kind: "email address", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "IP address", pattern: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g },
];

const harmlessIps = new Set(["127.0.0.1", "0.0.0.0", "255.255.255.255"]);
const harmlessEmailDomains = /@(?:example\.(?:com|org|net)|users\.noreply\.github\.com)$/i;

/**
 * Heuristic scan for credentials and personal data. It is a last line of
 * defense for fixtures you intend to commit, not a guarantee.
 */
export function scanForSecrets(lines) {
  const findings = [];
  lines.forEach((line, index) => {
    const text = typeof line === "string" ? line : JSON.stringify(line);
    for (const { kind, pattern } of detectors) {
      for (const match of text.matchAll(pattern)) {
        const value = match[0];
        if (kind === "IP address" && (harmlessIps.has(value) || isPrivateIp(value) || looksLikeVersion(text, match.index))) continue;
        if (kind === "email address" && harmlessEmailDomains.test(value)) continue;
        findings.push({ line: index + 1, kind, preview: mask(value) });
      }
    }
  });
  return findings;
}

function isPrivateIp(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function looksLikeVersion(text, index) {
  const before = text.slice(Math.max(0, index - 12), index);
  return /(?:\bv|version\s*|\d\.)$/i.test(before);
}

function mask(value) {
  if (value.length <= 8) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}
