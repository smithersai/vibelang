import type { Plugin } from "vite"

export interface VibeLangOptions {
  /** tsconfig path relative to Vite's root. Defaults to tsconfig.json. */
  project?: string
  /** Native vibelang binary or Node launcher path. Defaults to vibelang. */
  compiler?: string
  /**
   * Vitest only: add `--import` of `vibelang/register` to the tests'
   * NODE_OPTIONS, so a Node process a test starts, such as a CLI run from
   * source, imports .vibe modules too, and `--preload` of `vibelang/bun`
   * to BUN_OPTIONS for a Bun process. Defaults to false.
   */
  register?: boolean
  /**
   * The platform whose worker runner serves a `with { type: "worker" }`
   * import's entry chunk (VIP-57). Defaults to `"node"` in a server
   * environment, such as SSR, and to `"browser"` in any other.
   */
  workerPlatform?: "node" | "bun" | "browser"
}

export default function vibelang(options?: VibeLangOptions): Plugin
