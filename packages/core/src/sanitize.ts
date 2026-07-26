export const EXCERPT_MAX_LEN = 600;
const REDACTED = "[redacted]";
const PRE_CAP = 4000;

// Order matters: (1) URL/hostname rules run before bare-IP so host:port inside
// URLs are killed as one unit. (2) ipv6 rule must run before bare-service-port so
// hex-group fragments like "8a2e:370" in IPv6 addresses aren't consumed as
// service:port patterns. DoS containment comes from PRE_CAP bounding regex input
// to 4000 chars before any rule runs — the rules themselves are NOT asymptotically
// linear. Do not raise or remove PRE_CAP without re-timing adversarial inputs.
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
  {
    name: "bare-service-port",
    re: /\b(?=[\w-]*[a-z])[\w-]+:\d{2,5}\b/gi,
  },
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
