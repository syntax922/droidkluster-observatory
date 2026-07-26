// The site has no `vite/client` types declared (no vite.config.ts / no `types`
// entry in tsconfig), so `import.meta.env` is untyped by default. Rather than
// any-cast at the call site, declare only the env var this app actually reads.
interface ImportMetaEnv {
  readonly VITE_DATA_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
