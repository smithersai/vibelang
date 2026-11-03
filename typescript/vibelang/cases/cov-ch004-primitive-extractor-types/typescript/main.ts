import { Effect } from "effect"
/** @throws {never} */
export function text(s:unknown){return typeof s==="string"?s:s instanceof String?s.valueOf():""}
/** @throws {never} */
export function number(s:unknown){return typeof s==="number"?s:s instanceof Number?s.valueOf():0}
/** @throws {never} */
export function boolean(s:unknown){return typeof s==="boolean"?s:s instanceof Boolean?s.valueOf():false}
/** @throws {never} */
export function big(s:unknown){return typeof s==="bigint"?s:s instanceof BigInt?s.valueOf():0n}
/** @throws {never} */
export function symbol(s:unknown){return typeof s==="symbol"?s:s instanceof Symbol?s.valueOf():Symbol.for("fallback")}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>[text("x"),number(7),boolean(true),String(big(9n)),symbol(Symbol.for("x"))===Symbol.for("x")])}
