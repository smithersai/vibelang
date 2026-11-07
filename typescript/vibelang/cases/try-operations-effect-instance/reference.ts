import { Effect as Eff, Fiber as Fib } from "effect"
function check(mode:number) { return Eff.gen(function* () {
  const anchor=yield* Eff.forkChild(Eff.gen(function* () {
    const Effect = { all: 0, exit: 0, raceAll: 0, raceAllFirst: 0 }
    void Effect
    const owner=yield* Eff.fiberId
    const jobs=[1,2,3].map(item=>Eff.gen(function* () {
      const current=yield* Eff.fiberId
      const child=yield* Eff.forkChild(Eff.succeed(item))
      const okay=owner<current && current<child.id
      yield* Fib.join(child)
      return okay
    }))
    switch(mode) {
      case 0: return [yield* Eff.raceAllFirst(jobs)]
      case 1: return [yield* Eff.raceAll(jobs)]
      case 2: return (yield* Eff.all(jobs.map(Eff.exit),{concurrency:"unbounded"})).map(x=>x._tag==="Success"&&x.value)
      case 3: return (yield* Eff.all([...jobs].map(Eff.exit),{concurrency:"unbounded"})).map(x=>x._tag==="Success"&&x.value)
      case 4: return (yield* Eff.all([Eff.exit(jobs[0]),Eff.exit(jobs[1]),Eff.exit(jobs[2])],{concurrency:"unbounded"})).map(x=>x._tag==="Success"&&x.value)
      case 5: return [yield* Eff.raceAllFirst([jobs[0],jobs[1],jobs[2]])]
      default: return [yield* Eff.raceAll([jobs[0],jobs[1],jobs[2]])]
    }
  }))
  return yield* Fib.join(anchor)
}) }
export function main() { return Eff.gen(function* () {
  const seen:boolean[]=[]
  for(const mode of [0,1,2,3,4,5,6]) seen.push(...(yield* check(mode)))
  return seen
}) }
