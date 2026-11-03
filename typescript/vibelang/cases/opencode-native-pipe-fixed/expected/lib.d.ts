import { Context, Effect } from "effect";
import { HttpRouter } from "effect/http";
export declare const handler: (context: Context.Context<HttpRouter.HttpRouter>) => Effect.Effect<(request: Request, context?: Context.Context<never> | undefined) => Promise<globalThis.Response>, never, never>;
