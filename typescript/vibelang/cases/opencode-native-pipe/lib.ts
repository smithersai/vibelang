import { Context, Effect } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter } from "effect/http"

export const handler = Effect.fn("handler")(function* (context: Context.Context<HttpRouter.HttpRouter>) {
  yield* Effect.void
  return Context.get(context, HttpRouter.HttpRouter)
    .asHttpEffect()
    .pipe(HttpMiddleware.cors({ maxAge: 1 }), HttpEffect.toWebHandlerWith(context))
})
