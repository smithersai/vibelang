export interface VibeLangOptions {
  /** tsconfig path relative to the root. Defaults to tsconfig.json. */
  project?: string
  /**
   * Project root. The compiler scopes emit to this directory (`--loader-root`) and overrides `rootDir` to the filesystem root.
   * Defaults to the Vite root, the webpack or Rspack context, Rolldown's
   * cwd, esbuild's absWorkingDir, or process.cwd().
   */
  root?: string
  /** Native vibelang binary or Node launcher path. Defaults to VIBELANG_BINARY, then the root's vibelang package, then the one beside the plugin. */
  compiler?: string
  /**
   * The platform whose worker runner serves a `with { type: "worker" }`
   * import's entry chunk (VIP-57). Defaults to `"node"` for Rolldown's
   * `platform: "node"`, a webpack or Rspack Node or Electron main target, and
   * a Vite server environment, and to `"browser"` otherwise, including Rollup,
   * which has no platform.
   */
  workerPlatform?: "node" | "bun" | "browser"
}
