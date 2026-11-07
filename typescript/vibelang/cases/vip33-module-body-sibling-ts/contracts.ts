import type * as Body from "./main.vibe"
import type * as Sibling from "./host.ts"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<A extends true> = A
// The body's public types are the sibling .ts file's.
export type Contracts = [
  Assert<Equal<typeof Body.cwd, typeof Sibling.cwd>>,
  Assert<Equal<typeof Body.size, typeof Sibling.size>>,
  Assert<Equal<typeof Body.newline, typeof Sibling.newline>>,
]
