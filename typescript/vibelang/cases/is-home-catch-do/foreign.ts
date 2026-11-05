/** @throws {unknown} */
export function raise(value: unknown): never { throw value }

// TypeScript control for the explicit lexical block inside the default.
export function nativeCaught(value: any, n: number): unknown[] {
  const result: unknown[] = []
  try { raise(value) } catch ({ code = (() => { const c = n; const ok = true; result.push(c); return ok })() }: any) { result.push(code) }
  return result
}
