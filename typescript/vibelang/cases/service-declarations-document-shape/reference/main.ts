import { Context, Effect } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
class Document extends Context.Service<Document, { current: Effect.Effect<globalThis.Document> }>()("Experimental/Document") {}
type Shape = Context.Service.Shape<typeof Document>
type Actual = Effect.Success<Shape["current"]>
export const exactDocument: Equal<Actual, globalThis.Document> = true
export const eventMap: Equal<Parameters<Actual["getElementById"]>, [elementId: string]> = true
export function main(): Effect.Effect<number> { return Effect.succeed(1) }
