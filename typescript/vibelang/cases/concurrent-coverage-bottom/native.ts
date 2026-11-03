import { Effect, Stream } from "effect"
// VIP-18/19/20 ordinary assignability to named collection domains.
export function bottomReference(xs: never) { return Effect.all(xs, {concurrency:"unbounded"}) }
export function dynamicReference(xs: any) { return Effect.all(xs, {concurrency:"unbounded"}) }
export function domains(s: Stream.Stream<any,any,any>, xs: Iterable<unknown>, es: ReadonlyArray<Effect.Effect<any,any,any>>) {
 return [Stream.runForEach(s, () => Effect.void), Effect.forEach(xs, () => Effect.void), Effect.all(es)]
}

// docs/design/vips/0018-concurrent.md#fcba84815af204a9 | VIP-18 named-TypeScript-collection-domains
// Effect TypeScript counterpart: the corresponding parameter domains are `Stream.runForEach`'s Stream, `Effect.forEach`'s iterable and `Effect.all`'s readonly array of programs for this form.
