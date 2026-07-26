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

export function readConfig(env: Record<string, string | undefined>): ProjectorConfig {
  return {
    natsServers: csv(env, "NATS_SERVERS"),
    ...(env.NATS_NKEY_SEED_FILE ? { natsNkeySeedFile: env.NATS_NKEY_SEED_FILE } : {}),
    ...(env.NATS_CA_FILE ? { natsCaFile: env.NATS_CA_FILE } : {}),
    natsStream: req(env, "NATS_STREAM"),
    natsDurable: req(env, "NATS_DURABLE"),
    filterSubjects: csv(env, "NATS_FILTER_SUBJECTS"),
    r2: {
      accountId: req(env, "R2_ACCOUNT_ID"),
      bucket: req(env, "R2_BUCKET"),
      accessKeyId: req(env, "R2_ACCESS_KEY_ID"),
      secretAccessKey: req(env, "R2_SECRET_ACCESS_KEY"),
    },
    pushEnabled: env.OBSERVATORY_PUSH_ENABLED !== "false",
    debounceMs: numEnv(env, "PUSH_DEBOUNCE_MS", 10000),
    heartbeatMs: numEnv(env, "PUSH_HEARTBEAT_MS", 60000),
  };
}
