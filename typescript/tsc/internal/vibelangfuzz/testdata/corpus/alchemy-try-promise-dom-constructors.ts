import * as Effect from "effect/Effect";
export const make = (input: string) => Effect.tryPromise(() => Promise.resolve(new Response(input)));
export const headers = (input: Readonly<Record<string, string>>) =>
  Effect.tryPromise(() => Promise.resolve(new Headers(input)));
