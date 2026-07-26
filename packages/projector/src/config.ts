export interface ProjectorConfig {
  natsServers: string[];
  natsNkeySeedFile?: string;
  natsCaFile?: string;
  natsStream: string;
  natsDurable: string;
  filterSubjects: string[];
  r2: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string };
  pushEnabled: boolean;
  debounceMs: number;
  heartbeatMs: number;
}

function req(env: Record<string, string | undefined>, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`required env var ${name} not set`);
  return v;
}

function csv(env: Record<string, string | undefined>, name: string): string[] {
  return req(env, name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function numEnv(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) throw new Error(`invalid numeric value for ${name}`);
  return n;
}

/**
 * Extracts only the four R2_* vars. Split out from readConfig() so
 * standalone CLIs (curate.js) that only ever touch the R2 bucket don't have
 * to satisfy the full projector env contract (NATS_*) just to read/write
 * chains and replays.
 */
export function readR2Config(env: Record<string, string | undefined>): ProjectorConfig["r2"] {
  return {
    accountId: req(env, "R2_ACCOUNT_ID"),
    bucket: req(env, "R2_BUCKET"),
    accessKeyId: req(env, "R2_ACCESS_KEY_ID"),
    secretAccessKey: req(env, "R2_SECRET_ACCESS_KEY"),
  };
}

export function readConfig(env: Record<string, string | undefined>): ProjectorConfig {
  return {
    natsServers: csv(env, "NATS_SERVERS"),
    ...(env.NATS_NKEY_SEED_FILE ? { natsNkeySeedFile: env.NATS_NKEY_SEED_FILE } : {}),
    ...(env.NATS_CA_FILE ? { natsCaFile: env.NATS_CA_FILE } : {}),
    natsStream: req(env, "NATS_STREAM"),
    natsDurable: req(env, "NATS_DURABLE"),
    filterSubjects: csv(env, "NATS_FILTER_SUBJECTS"),
    r2: readR2Config(env),
    pushEnabled: env.OBSERVATORY_PUSH_ENABLED !== "false",
    debounceMs: numEnv(env, "PUSH_DEBOUNCE_MS", 10000),
    heartbeatMs: numEnv(env, "PUSH_HEARTBEAT_MS", 60000),
  };
}
