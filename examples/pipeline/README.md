# Sensor pipeline

A lazy callback stream supplies sensor readings to `Stream.filter`, `Stream.map`,
and `Stream.take`. A `for try` loop consumes the resulting Stream.
The stream closes once `Stream.take` has its second matching reading.
Its finalizer logs closure, including when downstream stops early.

From this directory, with `vibelang` on `PATH`:
```sh
bun install
bun run build
bun run start
```

The source uses `Stream.callback` and the consumer uses `for try`.
The consuming loop in Effect TypeScript is:
```ts
const consume = Stream.runForEach(alerts, (alert) =>
  Console.log(`temperature alert: ${alert}`)
)
```

When `Stream.take` receives the second alert, it closes the upstream stream.
The callback stream's finalizer logs closure before the consumer handles the
second alert.
