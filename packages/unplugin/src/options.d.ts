export interface VibeLangOptions {
  /** tsconfig path relative to the root. Defaults to tsconfig.json. */
  project?: string
  /**
   * Project root. The compiler runs here with rootDir set to it.
   * Defaults to the Vite root, the webpack or Rspack context, esbuild's
   * absWorkingDir, or process.cwd().
   */
  root?: string
  /** Native vibelang binary or Node launcher path. Defaults to VIBELANG_BINARY, then the root's vibelang package, then the one beside the plugin. */
  compiler?: string
}
