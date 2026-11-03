import * as vibe from "./main.js"
import * as twin from "./twin.js"

type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false
type Shapes = {
  [K in "bareCatch" | "tried" | "piped" | "pipeCatch" | "nestedCatch" | "instance"]:
    Same<ReturnType<(typeof vibe)[K]>, ReturnType<(typeof twin)[K]>>
}
export const types: Shapes = {
  bareCatch: true, tried: true, piped: true,
  pipeCatch: true, nestedCatch: true, instance: true,
}
