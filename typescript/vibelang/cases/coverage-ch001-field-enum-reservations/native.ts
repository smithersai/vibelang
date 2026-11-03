import { Effect } from "effect"
const fork = (n: number) => n; const join = (n: number) => n;
export function f() { return Effect.gen(function* () {
 class C { n = join(1); static n = fork(2) }; enum E { A = join(3) }
 return [new C().n, C.n, Number(E.A)]
}) }
