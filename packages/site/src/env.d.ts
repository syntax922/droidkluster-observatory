// The site has no `vite/client` types declared (no vite.config.ts / no `types`
// entry in tsconfig), so `import.meta.env` is untyped by default. Rather than
// any-cast at the call site, declare only the env var this app actually reads.
interface ImportMetaEnv {
  readonly VITE_DATA_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// TS7 (TS2882) requires a module declaration for every import, including
// side-effect-only ones — `main.ts` imports "./style.css" purely for its
// styling side effect, so declare the shape (none) rather than pull in the
// full `vite/client` types the file above is already avoiding.
declare module "*.css";
