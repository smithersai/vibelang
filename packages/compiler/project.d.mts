export interface Diagnostic {
  readonly file?: string
  readonly line?: number
  readonly column?: number
  readonly category: "error" | "warning"
  readonly code: string
  text: string
}

export interface Output {
  readonly code: string
  readonly map: { sources: Array<string>; sourceRoot: string; [key: string]: unknown }
}

export interface Result {
  /**
   * Each .vibe source, by listed and real path, to its JavaScript and source
   * map, and each output of its module declarations, such as main.vibe.text.js
   * beside main.vibe, to that module's.
   */
  readonly outputs: Map<string, Output>
  /** Project source files the result depends on. */
  readonly inputs: Array<string>
  /** Every file the compiler listed, including dependencies. */
  readonly files: Array<string>
  /** All project error diagnostics; emitted outputs may still be available. */
  readonly errors: Array<Diagnostic>
  /** All project warning diagnostics. */
  readonly warnings: Array<Diagnostic>
}

export interface Loaded {
  /** The tsconfig whose compile served the module. */
  readonly project: string
  readonly code: string
  readonly map?: Output["map"]
  readonly inputs: Array<string>
  /** Errors for this source and project-wide errors. The module's code throws when there are any. */
  readonly errors: Array<Diagnostic>
  /** Warnings for this source and project-wide warnings. */
  readonly warnings: Array<Diagnostic>
  /** True for the first module loaded from this compile. */
  readonly first: boolean
  /** Set when the project does not include the module. */
  readonly error?: false | { readonly message: string; readonly id: string }
}

export interface Import {
  /** The file that writes the import. */
  readonly importer: string
  /** The specifier as written, such as `./User.vibe` or `effect/Schema`. */
  readonly specifier: string
  /** The file the compiler resolved the specifier to. */
  readonly file: string
}

export interface Imports {
  /** Every file of the program except the compiler's bundled libraries. */
  readonly files: Array<string>
  /** Every import the program's files write, type-only imports included. */
  readonly imports: Array<Import>
  /** Diagnostics that stopped the compiler from reading the project; files and imports are then incomplete. */
  readonly errors: Array<Diagnostic>
}

/**
 * Where compiles are cached. VIBELANG_DISABLE_CACHE=1 turns the cache off
 * everywhere. Otherwise false turns it off, `directory` moves it, and without
 * an option it is VIBELANG_CACHE_DIR, else a private directory under the
 * system's temporary directory.
 */
export type CacheOption = false | { readonly directory: string }

export function findCompiler(root: string, compiler?: string): string
/**
 * The .vibe file whose module declaration compiles to `path`, as main.vibe's
 * `module text` compiles to main.vibe.text.js, or undefined.
 */
export function moduleDeclarationSource(path: string): string | undefined
export function parseOutput(output: string, root: string): { files: Array<string>; diagnostics: Array<Diagnostic> }
export function parseExplainFiles(output: string, root: string): { files: Array<string>; imports: Array<Import>; diagnostics: Array<Diagnostic> }
export function projectImports(options: { project: string; root?: string; compiler?: string }): Imports
export function formatDiagnostic(diagnostic: Diagnostic): string
export function projectBackend(options: {
  root: string
  compiler: string
  cache?: CacheOption
  debug?: (text: string) => void
}): {
  compile(project: string): Promise<Result>
  /** Waits for compiles, terminating them after a bounded grace period, and closes their pipes. */
  close(): Promise<void>
}
export function compileProjectSync(options: {
  project: string
  root?: string
  compiler?: string
  cache?: CacheOption
  debug?: (text: string) => void
}): Result
export function nearestProject(file: string): string | undefined

/**
 * The project that compiles `file` when `project` (in directory `root`) is asked
 * for: `project` for a module inside root; for one of another workspace package,
 * outside root or nested inside it with its own package.json and tsconfig.json,
 * the nearest tsconfig.json above it.
 */
export function workspaceProject(file: string, root: string, project: string): string
export function projects(options: {
  root: string
  project: string
  compiler: string
  cache?: CacheOption
  debug?: (text: string) => void
}): {
  projectOf(file: string): string
  /** Closes every project backend. Further loads reject. */
  close(): Promise<void>
  invalidate(): void
  load(file: string): Promise<Loaded>
}
