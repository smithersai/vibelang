// expect-result: {"reads":1,"plain":[true,true,true],"nullTypeError":true,"sameError":true}
// A JavaScript catch binding typed any retains native destructuring and defaults.
declare function work(): void
export function destructured() {
  try { work() } catch ({ code = 1 }: any) {}
}


// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Ordinary any catch bindings follow JavaScript; the existing typed legacy catch witness retains its untagged-error diagnostic.
export function readCode(source: { readonly code: number }): number {
  try { return source.code }
  catch ({ code = 1 }: any) { return code }
}
