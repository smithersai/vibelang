import { Context, Effect, Scope } from "effect";
class Model extends Context.Service<Model, { readonly name: string }>()("app/Model") {}
class Other extends Context.Service<Other, { readonly count: number }>()("app/Other") {}
interface Plugin<R> { readonly effect: (ctx: string) => Effect.Effect<void, never, R> }
declare function define<R>(plugin: Plugin<R>): Plugin<R>;
export const plugin = define({
  effect: Effect.fn("Plugin")(function* (ctx: string) {
    yield* Model;
  }),
} satisfies Plugin<Scope.Scope | Model | Other>);
