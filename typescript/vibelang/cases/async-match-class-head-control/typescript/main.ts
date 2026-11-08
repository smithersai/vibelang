import { Effect } from "effect"

async function run() {
  const trace: string[] = []
  return await (async () => {
    const subject = 1
    return (() => {
      class C extends (() => { trace.push("base"); return class {} })() {
        [(() => { trace.push("key"); local: { break local }; return "m" })()]() { return 1 }
        value = () => { return 7 }
        get result() { return this.value() }
      }
      const instance = new C();
      return [instance.result, trace]
    })()
  })()
}

export function main() { return Effect.gen(function* () { return yield* Effect.promise(run) }) }
