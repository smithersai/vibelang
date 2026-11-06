import * as Effect from "effect/Effect";
let built = 0, ran = 0;
export function build() {
  const stamp = ++built;
  return Effect.sync(() => { ran++; return stamp; });
}
export const state = () => [built, ran];
