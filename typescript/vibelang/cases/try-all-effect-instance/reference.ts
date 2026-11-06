import { Effect as Eff, Fiber as Fib } from "effect"
function check(mode: number) {
  return Eff.gen(function* () {
    const anchor = yield* Eff.forkChild(Eff.gen(function* () {
      const Effect = { all() { throw new Error("captured local") } }
      void Effect
      const owner = yield* Eff.fiberId
      const jobs = [1,2,3].map(item => Eff.gen(function* () {
        const current = yield* Eff.fiberId
        const child = yield* Eff.forkChild(Eff.succeed(item))
        const okay = owner < current && current < child.id
        yield* Fib.join(child)
        return okay
      }))
      const make = () => jobs
      let evaluations = 0
      switch (mode) {
        case 0: return yield* Eff.all([jobs[0],jobs[1],jobs[2]], {concurrency:"unbounded"})
        case 1: return yield* Eff.all(jobs, {concurrency:"unbounded"})
        case 2: return yield* Eff.all([jobs[0],jobs[1],jobs[2]], {concurrency:"unbounded"})
        case 3: return yield* Eff.all([...jobs], {concurrency:"unbounded"})
        case 4: return yield* Eff.all(jobs, {concurrency:"unbounded"})
        case 5: return yield* Eff.all(make(), {concurrency:"unbounded"})
        case 6: return yield* Eff.all([], {concurrency:"unbounded"})
        default: {
          const result = yield* Eff.all((evaluations++,jobs), {concurrency:"unbounded"})
          return [...result,evaluations===1]
        }
      }
    }))
    return yield* Fib.join(anchor)
  })
}
export function main() {
  return Eff.gen(function* () {
    const seen:boolean[]=[]
    for (const mode of [0,1,2,3,4,5,6,7]) seen.push(...(yield* check(mode)))
    return seen
  })
}
