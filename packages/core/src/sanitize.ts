export const EXCERPT_MAX_LEN = 600;
const REDACTED = "[redacted]";
const PRE_CAP = 4000;

// Order matters: URL/hostname rules run before the bare-IP rule so a host:port
// inside a URL is killed as one unit. Private-TLD rule is linear (no backtracking).
const KILL_RULES: Array<{ name: string; re: RegExp }> = [
  { name: "url", re: /\bhttps?:\/\/[^\s)]+/gi },
  { name: "internal-host", re: /\b[\w.-]*droidkluster\.(internal|com)\b(:\d+)?/gi },
  { name: "host-port", re: /\b[\w-]+(?:\.[\w-]+)+:\d{2,5}\b/g },
  {
    name: "private-tld-host",
    re: /\b[\w.-]+\.(internal|local|lan|corp|home|cluster|svc|intra)\b(:\d+)?/gi,
  },
  {
    name: "ipv4",
    re: /(?<![.])(?:\d{1,3}\.){3}\d{1,3}(:\d+)?\b/g,
  },
  { name: "ipv6", re: /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f:]+\b/gi },
  { name: "gh-token", re: /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\b/g },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._+/=-]{16,}/g },
  {
    name: "abs-path",
    re: /(?:^|[\s('"`])\/(?:[\w.-]+(?: [\w.-]+)*\/)+[\w.-]+/g,
  },
  { name: "email", re: /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g },
];

export function scrubExcerpt(text: string): string {
  let out = text.slice(0, PRE_CAP);
  for (const rule of KILL_RULES) {
    out = out.replace(rule.re, (match) => {
      // abs-path keeps its leading delimiter so sentences stay readable.
      const lead = /^[\s('"`]/.exec(match)?.[0] ?? "";
      return `${lead}${REDACTED}`;
    });
  }
  out = out.replace(/\s{2,}/g, " ").trim();
  if (out.length > EXCERPT_MAX_LEN) {
    out = `${out.slice(0, EXCERPT_MAX_LEN - 1).trimEnd()}…`;
  }
  return out;
}
