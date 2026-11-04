import assert from "node:assert/strict"
import { Effect } from "effect"
export function observe(program) {
  const lines = []
  const print = (...parts) => lines.push(parts.map(String).join(" "))

  {
    const p = program.compact(1, 2)
    print("compact", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.expanded(1, 2)
    print("expanded", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.declared(1, 2)
    print("declaration", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.expression(1, 2)
    print("expression", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = new program.Counter().compact(1, 2)
    print("method compact", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = new program.Counter().expanded(1, 2)
    print("method expanded", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.object.read(1, 2)
    print("object method", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  const fresh = program.fresh(1, 2)
  const first = Effect.runSync(fresh)
  const second = Effect.runSync(fresh)
  const third = Effect.runSync(fresh)
  assert.equal(first, second, "rest array belongs to the call")
  assert.equal(second, third, "rerunning reuses the same rest binding")
  print("fresh arrays", first !== second && second !== third && first !== third)
  for (const [name, p] of [
    ["default", new program.Defaults().read()],
    ["destructured default", new program.Defaults().destructured()],
    ["effect declaration", program.declaredProgram(1, 2)]
  ]) print(name, JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))

  return lines
}
