import type { Output } from "./project.mjs"

/** The project that compiles `file`: VIBELANG_PROJECT for a module in its directory, else the nearest tsconfig.json above it. */
export function projectOf(file: string): string
/**
 * The JavaScript and source map that `file`'s project compile emits for the
 * .vibe module `file`. Throws an Error with code ERR_VIBELANG_COMPILE on the
 * module's errors, and ERR_VIBELANG_PROJECT when the project does not include it.
 */
export function emitModule(file: string): Output
/**
 * The module's emitted JavaScript when `file` is a .vibe module and `text` is
 * its source as on disk (or omitted), else undefined.
 */
export function toolSource(file: string, text?: string | Uint8Array): Output | undefined
/** The arguments of `tool(filename, text, options)` with a .vibe module's source replaced by its JavaScript (`lang: "jsx"`). */
export function toolArguments<O extends object | undefined>(filename: string, text: string, options: O): [string, string, O & { lang?: "jsx" }]
/** Moves every `loc` of a Babel or ESTree tree parsed from emitted JavaScript to its .vibe position, in place. Returns `ast`. */
export function remapLocations<T>(ast: T, map: Output["map"]): T
