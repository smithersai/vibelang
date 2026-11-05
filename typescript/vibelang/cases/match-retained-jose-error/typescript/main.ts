import { Effect } from "effect"
import * as Errors from "effect/jose/JoseError"
import { JoseError as ErrorClass, isJoseError as importedGuard } from "effect/jose/JoseError"
import { JoseError as Barrel } from "effect/jose"

const Alias = Errors.JoseError
const aliasGuard = Errors.isJoseError
function arity(value: unknown, wanted: number) {
 if (!Errors.isJoseError(value)) return false
 const extracted = [value]
 return extracted.length === wanted
}
function inspect(value: unknown) {
 return [
  Errors.isJoseError(value),
  Errors.isJoseError(value) ? value._tag : "miss",
  importedGuard(value) ? value === value : false,
  aliasGuard(value) ? value === value && Barrel.isJoseError(value) : false,
  arity(value, 0),
  arity(value, 2),
  Errors.isJoseError(value) ? [value].length : 0,
 ]
}
export function main() {
 const copy={_tag:"JoseError","~effect/jose/JoseError":"~effect/jose/JoseError"}
 return Effect.succeed([inspect(copy),inspect({_tag:"JoseError"}),inspect(null)])
}
