// A native module that setup routed to counter.vibe. Its JavaScript and
// declarations name ./counter.js, the module's own output, so no route
// reaches published code (expected/).
export * from "#vibelang/emitted/counter"
import { bump } from "#vibelang/emitted/counter"

/** @throws {never} */
export const bumpTwice = (): number => {
  bump()
  return bump()
}

export const load = () => import("#vibelang/emitted/counter")
