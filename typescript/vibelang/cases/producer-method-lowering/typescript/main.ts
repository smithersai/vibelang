import { Effect, Queue, Stream } from "effect"

export function main(): Effect.Effect<readonly unknown[], never, never> {
  return Effect.gen(function* () {
    const events: string[] = []
    events.push("0")
    class Base { value() { return 2 } }
    class C extends Base {
      n = 5
      values(): Stream.Stream<number> {
        const self = this
        const parentValue = () => super.value()
        return Stream.callback<number, never, never>(queue => Effect.gen(function* () {
          events.push("yield" + self.n)
          yield* Queue.offer(queue, self.n)
          yield* Effect.sleep(1)
          yield* Queue.offer(queue, parentValue())
        }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })
      }
    }
    const c = new C()
    const stream = c.values()
    events.push("created")
    c.n = 7
    const first = yield* Stream.runCollect(stream)
    c.n = 9
    const second = yield* Stream.runCollect(stream)
    return [[first, second], events]
  })
}
