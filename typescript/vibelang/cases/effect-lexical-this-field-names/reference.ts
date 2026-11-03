import { Effect, Exit } from "effect"
let keyCalls = 0
function computedKey(): "computed" { keyCalls++; return "computed" }
const computed = computedKey()
class Named {
  value = 7
  literal = (flag: boolean) => Effect.sync(() => { if (flag) return this.value; return 5 });
  #hidden = (flag: boolean) => Effect.sync(() => { if (flag) return this.value; return 5 });
  [computed] = (flag: boolean) => Effect.sync(() => { if (flag) return this.value; return 5 })
  factory = (flag: boolean) => Effect.sync(() => { if (flag) return this.value; return 5 });
  destructured({ read = (flag: boolean) => Effect.sync(() => { if (flag) return this.value; return 5 }) } = {}) { return read }
  defaultBlock({ p = Effect.sync(() => this.value) } = {}) { return p }
  defaulted(read = (flag: boolean) => Effect.sync(() => { if (flag) return this.value; return 5 })) { return read }
  names() { return { literal: this.literal.name, hidden: this.#hidden.name, computed: this.computed.name, default: this.defaulted().name, factory: this.factory.name, destructured: this.destructured().name } }
  programs() { return [this.literal(true), this.#hidden(true), this.computed(true), this.defaulted()(true), this.factory(true), this.destructured()(true), this.defaultBlock()] }
}
function shape(e: Effect.Effect<unknown>): string {
  const x = Effect.runSyncExit(e)
  if (Exit.isSuccess(x)) return "Success(" + String(x.value) + ")"
  return x.cause.reasons.map(r => r._tag === "Die" && r.defect instanceof ReferenceError ? "ReferenceError" : r._tag).join("+")
}
const nested: string[] = []
class Base { value = 7 }
class Nested extends Base {
  constructor(flag: boolean) {
    const p = Effect.sync(() => { if (flag) return this.value; return 5 })
    nested.push(shape(p))
    super()
    nested.push(shape(p))
  }
}
new Nested(false)
new Nested(true)
class DefaultCapture extends Base {
  constructor({ p = Effect.sync(() => this.value) } = {}) { super(); nested.push(shape(p)) }
}
new DefaultCapture()
const x = new Named()
console.log(JSON.stringify({ names: x.names(), keyCalls, values: Effect.runSync(Effect.all(x.programs())), nested }))
