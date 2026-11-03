
import { Effect } from "effect"
class Base { n = 7; tag(_parts: TemplateStringsArray, value: number) { return this.n + value } }
class Derived extends Base {
 go() { const tag = (value:number) => super.tag`value ${value}`; return Effect.gen(function* () {
  yield* Effect.yieldNow; const value = 2
  return yield* Effect.sync(() => tag(value))
 }) }
}
const forbidden = () => { throw new Error("own call or bind was read") }
Object.defineProperty(Base.prototype.tag, "call", {get:forbidden})
Object.defineProperty(Base.prototype.tag, "bind", {get:forbidden})
export const main = () => new Derived().go()
