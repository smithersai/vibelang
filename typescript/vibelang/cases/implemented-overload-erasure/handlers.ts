export interface Apply {
  apply<A>(a: A): A
  apply<A, B>(a: A, ab: (_: A) => B): B
  apply<A, B, C>(a: A, ab: (_: A) => B, bc: (_: B) => C): C
}

/** @throws {never} */
export function safeApply<A>(a: A): A
/** @throws {never} */
export function safeApply<A, B>(a: A, ab: (_: A) => B): B
export function safeApply(a: unknown, ...fs: Array<(_: unknown) => unknown>): unknown {
  return fs.reduce((x, f) => f(x), a)
}
