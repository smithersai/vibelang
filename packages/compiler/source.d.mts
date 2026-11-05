/**
 * Absolute paths of .ts, .tsx, .vibe and .vibex source files immediately in
 * directory, sorted by path. Excludes declaration outputs and directories.
 * Follows file symlinks. Throws for filesystem errors other than missing files.
 */
export function listSources(directory: string): string[]

/**
 * The absolute path of an existing file; for an absent .ts/.tsx source, its
 * .vibe/.vibex sibling. An existing exact file wins. Declaration names never
 * redirect. Returns undefined for missing files and directories, and throws
 * for other filesystem errors. Opt-in source-text lookup, not module resolution.
 */
export function resolveSource(file: string): string | undefined
