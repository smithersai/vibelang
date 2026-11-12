declare namespace metro {
  interface ResolverContext {
    originModulePath: string
    resolveRequest: (...args: never[]) => unknown
  }
  type Resolution = { type: "sourceFile"; filePath: string } | { type: "assetFiles"; filePaths: string[] } | { type: "empty" }
  type ResolveRequest = (context: ResolverContext, name: string, platform: string | null) => Resolution
  interface Config {
    projectRoot?: string
    resolver?: { sourceExts?: string[] }
    transformer?: { babelTransformerPath?: string }
  }
  type Configured<C extends Config> = Omit<C, "resolver" | "transformer"> & {
    resolver: Omit<C["resolver"], "sourceExts" | "resolveRequest"> & { sourceExts: string[]; resolveRequest: ResolveRequest }
    transformer: Omit<C["transformer"], "babelTransformerPath"> & { babelTransformerPath: string }
  }
  function withVibeLang<C extends Config>(config: C): Configured<C>
  function withVibeLang<C extends Config>(config: Promise<C>): Promise<Configured<C>>
  function withVibeLang<A extends unknown[], C extends Config>(config: (...args: A) => C): (...args: A) => Configured<C>
  function withVibeLang<A extends unknown[], C extends Config>(config: (...args: A) => Promise<C>): (...args: A) => Promise<Configured<C>>
  interface TransformArgs {
    filename: string
    src: string
    options?: { projectRoot?: string; [key: string]: unknown }
    plugins?: readonly unknown[]
  }
  interface TransformResult {
    ast?: unknown
    metadata?: unknown
    [key: string]: unknown
  }
  /** The configured upstream transformer's result, synchronously or asynchronously. */
  function transform(args: TransformArgs): TransformResult | Promise<TransformResult>
  function getCacheKey(...args: unknown[]): string
}
export = metro
