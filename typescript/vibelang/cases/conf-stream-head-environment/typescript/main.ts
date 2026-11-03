import { Effect, Stream } from "effect"
export function main() { return Effect.gen(function* () {
 const results: string[][] = []
 const x = 99
 {
  const events: string[] = []
  let probe: () => unknown = () => 0
  let stream: Stream.Stream<number> = Stream.empty
  for (const x of (probe = (): unknown => x, stream = Stream.fromIterable([1]), [] as number[])) {}
  yield* Stream.runForEachWhile(stream, (x) => Effect.sync(() => { events.push("item" + x); return true }))
  events.push(yield* Effect.sync(() => { try { probe(); return "read" } catch (e) { return (e as Error).name } }))
  results.push(events)
 }
 {
  const events: string[] = []
  let probe: () => unknown = () => 0
  let stream: Stream.Stream<number> = Stream.empty
  for (let x of (probe = (): unknown => x, stream = Stream.fromIterable([1]), [] as number[])) {}
  yield* Stream.runForEachWhile(stream, (x) => Effect.sync(() => { events.push("item" + x); return true }))
  events.push(yield* Effect.sync(() => { try { probe(); return "read" } catch (e) { return (e as Error).name } }))
  results.push(events)
 }
 {
  const events: string[] = []
  let probe: () => unknown = () => 0
  let stream: Stream.Stream<number[]> = Stream.empty
  for (const [x] of (probe = (): unknown => x, stream = Stream.fromIterable([[1]]), [] as number[][])) {}
  yield* Stream.runForEachWhile(stream, ([x]) => Effect.sync(() => { events.push("item" + x); return true }))
  events.push(yield* Effect.sync(() => { try { probe(); return "read" } catch (e) { return (e as Error).name } }))
  results.push(events)
 }
 {
  const events: string[] = []
  let probe: () => unknown = () => 0
  let stream: Stream.Stream<{ x: number }> = Stream.empty
  for (let { x } of (probe = (): unknown => x, stream = Stream.fromIterable([{ x: 1 }]), [] as { x: number }[])) {}
  yield* Stream.runForEachWhile(stream, ({ x }) => Effect.sync(() => { events.push("item" + x); return true }))
  events.push(yield* Effect.sync(() => { try { probe(); return "read" } catch (e) { return (e as Error).name } }))
  results.push(events)
 }
 return results
}) }
