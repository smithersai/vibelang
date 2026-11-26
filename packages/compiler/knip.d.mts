/** The TypeScript import/export surface Knip reads for a VibeLang source. */
export function compile(text: string, path?: string): string
/** Redirects type-only relative .js/.jsx imports and re-exports in TypeScript files to adjacent .vibe/.vibex modules. */
export function compileTypeScript(text: string, path?: string): string
/** Knip compilers map for .vibe/.vibex sources and TypeScript barrels re-exporting native types via .js/.jsx specifiers. */
export const compilers: {
  readonly vibe: typeof compile
  readonly vibex: typeof compile
  readonly ts: typeof compileTypeScript
  readonly tsx: typeof compileTypeScript
  readonly mts: typeof compileTypeScript
  readonly cts: typeof compileTypeScript
}
export default compile
