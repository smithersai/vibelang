import { Effect } from "effect"

/** @throws {never} */
export function f0(): number | undefined {
  for (let {n} = {n:1}; true;) { n = 2; return n }
}

/** @throws {never} */
export function f1(): number | undefined {
  for (let [n] = [1]; true;) { n = 2; return n }
}

/** @throws {never} */
export function f2(): number | undefined {
  for (let {a:n} = {a:1}; true;) { n = 2; return n }
}

/** @throws {never} */
export function f3(): number | undefined {
  for (let {a:{n}} = {a:{n:1}}; true;) { n = 2; return n }
}

/** @throws {never} */
export function f4(): { n: number } | undefined {
  for (let {...rest} = {n:1}; true;) { rest = { n: 2 }; return rest }
}

/** @throws {never} */
export function closures(): number[] {
  const out: (() => number)[] = []
  for (let { n } = { n: 0 }; n < 3 && (true); n++) out.push(() => n)
  return out.map(f => f())
}

export function main() {
  return Effect.sync(() => [f0(), f1(), f2(), f3(), f4(), closures()])
}
