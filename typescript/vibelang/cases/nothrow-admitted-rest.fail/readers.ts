export type Reader = {
  /** @throws {SyntaxError} */
  (): unknown
}
export type Plain = () => unknown

/** @throws {never} */
export function rest(...fs: Reader[]): unknown {
  try { return fs.map((f) => f()) } catch { return "caught" }
}
/** @throws {never} */
export function afterFixed(label: string, ...fs: Reader[]): unknown {
  try { return [label, fs.map((f) => f())] } catch { return "caught" }
}
/** @throws {never} */
export function pair(...fs: [Reader, Plain]): unknown {
  try { return fs.map((f) => f()) } catch { return "caught" }
}
/** @throws {never} */
export function fixed(f: Reader): unknown {
  try { return f() } catch { return "caught" }
}
/** @throws {never} */
export function fixedPlain(f: Plain): unknown {
  try { return f() } catch { return "caught" }
}
