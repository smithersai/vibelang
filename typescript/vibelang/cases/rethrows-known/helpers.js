import * as Effect from "effect/Effect";
/** @throws {Error} */
export function risky(_text) { throw new Error("bad"); }
/** @throws {never} */
export function safe(_text) { return 1; }
/** @throws {Error} */
export function fx(_text) { return Effect.succeed(1); }
/** @throws {never} @rethrows cb */
export function invoke(cb) { return cb(""); }
/** @throws {never} @rethrows cb */
export function tag(_parts, cb) { return cb(""); }
export function overloaded(text) { return text; }
