import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as M from "./out/main.js"
console.log(JSON.stringify([
  M.exitValue(Exit.succeed(1), 0), M.exitValue(Exit.fail("x"), 0),
  M.exitCause(Exit.succeed(1)), Cause.isCause(M.exitCause(Exit.fail("x"))),
  M.optionValue(Option.some(1), 0), M.optionValue(Option.none(), 0),
  M.resultSuccess(Result.succeed(1), 0), M.resultSuccess(Result.fail("x"), 0),
  M.resultFailure(Result.fail("x")), M.resultFailure(Result.succeed(1)),
  M.arrayExtractor([1]), M.arrayExtractor([1, 2]), M.arrayRest([1, 2, 3]), M.arrayRest([1]),
  M.typedArray(new Uint8Array([1, 2])), M.typedArray(new Uint8Array([1])),
  M.arrayPattern([1, 2]), M.arrayPattern([1]), M.arrayPatternRest([1, 2, 3]), M.arrayPatternRest([]),
  M.nested([[1], [2]]), M.nested([[1]]), M.iterated("go"), M.iterated("no"),
  M.objectIndex({ a: 1 }), M.objectIndex({}), M.objectShorthand({ a: 2 }), M.objectShorthand({}),
  M.taggedField(new M.Missing({ id: 7 })), M.taggedField("x"), M.taggedBinding("x"),
  M.objectNested({ a: { b: 1 } }), M.objectNested({ a: {} }), M.objectBesideTest({ kind: 1, a: 2 }), M.objectBesideTest({ a: 2 }),
  M.objectRest({ a: 1, b: 2 }), M.isObject({ a: 3 }), M.isObject({}),
  M.tuple([1, "a"]), M.variadicTuple([1, "a"]), M.variadicTuple([1]),
  M.optionalElement([1, "a"]), M.optionalElement([1]) ?? "short", M.holdsUndefined([undefined]) ?? "held", M.holdsUndefined([]),
  M.literalElement([1, 2]), M.literalElement([2, 2]), M.isPattern(["ab", "c"]), M.isPattern([]),
]))
