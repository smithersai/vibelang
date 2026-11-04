import { Effect } from "effect"
export function observe(program) {
  const lines = []
  const print = (...parts) => lines.push(parts.map(String).join(" "))

  {
    const p = new program.Counter(10).compact(1)
    print("compact", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = new program.Counter(10).expanded(1)
    print("expanded", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.Counter.compound(1)
    print("compound", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = new program.Counter(10).assignment(1)
    print("assignment", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = new program.Counter(0).destructured({ n: 1 })
    print("destructured", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = new program.Counter(0).loop(1)
    print("loop", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.object.read(1)
    print("object", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.nested(1)
    print("nested", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.destructuringAssignment(1)
    print("array assignment", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.objectAssignment(1)
    print("object assignment", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.postfix(1)
    print("postfix", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  {
    const p = program.logical(0)
    print("logical", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
  }
  for (const [name, p] of [
    ["parameter assignment", new program.Counter(0).redeclared(1)],
    ["arguments", new program.Counter(0).argumentsRead(1)],
    ["private method", new program.Counter(0).operation(1)],
    ["super", new program.Derived().read(1)]
  ]) print(name, JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))

  return lines
}
