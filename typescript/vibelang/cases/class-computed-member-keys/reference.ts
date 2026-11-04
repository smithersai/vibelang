// Effect TypeScript counterpart: the computed names run with yield* where the class is defined.
import { Effect } from "effect"
const key = <K extends string>(ev: string[], name: K) => Effect.sync((): K => { ev.push(name); return name })
class Base { base = 1 }
export function main() {
  return Effect.gen(function* () {
    const ev: string[] = []
    class C extends (ev.push("extends"), Base) {
      [yield* key(ev, "method")]() { return 2 }
      [yield* key(ev, "run")]() { return Effect.gen(function* () { return yield* Effect.succeed(6) }) }
      get [yield* key(ev, "getter")]() { return 3 }
      static [yield* key(ev, "static")]() { return 4 }
      set [yield* key(ev, "setter")](v: number) { }
    }
    const c: any = new C()
    const k: any = C
    const failed = yield* Effect.exit(Effect.gen(function* () { class D { [yield* Effect.fail("bad")]() { return 0 } }; return 1 }))
    const runner: { run(): Effect.Effect<number> } = c
    const ran = yield* runner.run()
    return [ev.join(","), c.method(), ran, c.getter, k.static(), "setter" in c, c.base, failed._tag]
  })
}
