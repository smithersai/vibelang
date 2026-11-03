function task() { return Effect.gen(function*() {
 const a = yield* <A/>
 const b = yield* Effect.forkChild(<A/>)
 const c = yield* Fiber.join(<A/>)
 return yield* Effect.fail(<A/>)
}) }
