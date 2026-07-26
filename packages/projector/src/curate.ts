// Local curation CLI. Uses the same bucket-scoped R2 credentials as the
// projector; promotes an auto-captured chain into the public replay rotation.
//   node dist/curate.js promote --chain pr-1607-2026-07-23 --title "CI red to merge in 41 minutes" --summary "..."
import { parseArgs } from "node:util";
import { ReplayBundleSchema, ReplayIndexSchema } from "@observatory/core";
import { readR2Config } from "./config.js";
import { EdgeWriter } from "./edge.js";

export async function promote(
  writer: EdgeWriter,
  args: { chain: string; title: string; summary: string },
): Promise<void> {
  const raw = await writer.getJson(`chains/${args.chain}.json`);
  if (!raw) throw new Error(`chain not found: chains/${args.chain}.json`);
  const bundle = ReplayBundleSchema.parse({
    ...ReplayBundleSchema.parse(raw),
    title: args.title,
  });

  const idxRaw = await writer.getJson("replays/index.json");
  if (idxRaw === null) {
    console.error(
      "index read returned null — writing fresh index (could clobber on transient outage); re-run to verify",
    );
  }
  const index = ReplayIndexSchema.parse(idxRaw ?? { replays: [] });
  const entry = {
    id: bundle.id,
    title: args.title,
    date: bundle.captured_on,
    summary: args.summary,
  };
  const replays = [entry, ...index.replays.filter((r) => r.id !== bundle.id)];

  await writer.putJson(`replays/${bundle.id}.json`, bundle, 86_400);
  await writer.putJson("replays/index.json", { replays }, 300);
  console.log(`promoted ${bundle.id} (${replays.length} in rotation)`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      chain: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
    },
  });
  if (positionals[0] !== "promote" || !values.chain || !values.title || !values.summary) {
    console.error("usage: curate.js promote --chain <id> --title <t> --summary <s>");
    process.exit(2);
  }
  const r2 = readR2Config(process.env);
  const writer = new EdgeWriter(r2);
  await promote(writer, {
    chain: values.chain,
    title: values.title,
    summary: values.summary,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
