import * as Effect from "effect/Effect";
export type Shape =
  | {
      /** branch doc */
      branch: { id: string };
      project?: never;
    }
  | {
      /** project doc */
      project: { id: string };
      branch?: never;
    };
type Resolve<T> = T extends Record<string, unknown>
  ? { [K in keyof T]: Resolve<T[K]> }
  : T;
export const read = Effect.fn(function* (scope: Resolve<Shape>) {
  return scope;
});
