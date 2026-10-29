# Sensor pipeline

A lazy producer supplies sensor readings to `Stream.filter`, `Stream.map`,
and `Stream.take`. A `for...of` loop consumes the resulting Stream.
The producer closes once `Stream.take` has its second matching reading.
Its finalizer logs closure, including when downstream stops early.

From this directory, with `vibelang` on `PATH`:
```sh
bun install
bun run build
bun run start
```

Features: `function*`, `yield`, a producer as a Stream, and `for...of` over a Stream.
The consuming loop in Effect TypeScript is:
```ts
const consume = Stream.runForEach(alerts, (alert) =>
  Console.log(`temperature alert: ${alert}`)
)
```

A producer is a Stream, so `Stream.filter` takes it directly. The producer
runs on its own fiber and may run up to two elements ahead of its consumer
(VIP-21). When `Stream.take` receives the second alert it ends the stream,
which closes the producer and runs its finalizer before the loop body handles
that alert, so the closure message comes between the two alerts in the output
fixture.
