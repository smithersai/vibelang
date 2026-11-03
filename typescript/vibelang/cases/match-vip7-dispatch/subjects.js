import { runInNewContext } from "node:vm"
export class Foreign {}
export const CrossRealm = runInNewContext("class CrossRealm {}; CrossRealm")
export class TaggedBase {
  static [Symbol.for("Symbol.customMatcher")](subject) { return subject?._tag === "TaggedBase" }
}
export class TaggedSub extends TaggedBase {}
export function inputs() {
  return [[], Object.create(Array.prototype), new Date(0), Object.create(Date.prototype),
    Object.setPrototypeOf(new Date(0), null), new Map(), new Error("x"),
    new RegExp("x"), new Set(), new WeakMap(), new WeakSet(), Promise.resolve(1),
    new Uint8Array([1]), new ArrayBuffer(1), new AggregateError([], "x"),
    ...[RegExp, Set, WeakMap, WeakSet, Promise, Uint8Array, ArrayBuffer, AggregateError].map(C => Object.create(C.prototype)),
    ...runInNewContext("[new RegExp('x'), new Set(), new WeakMap(), new WeakSet(), Promise.resolve(1), new Uint8Array([1]), new ArrayBuffer(1), new AggregateError([], 'x')]"),
    new Foreign(), Object.create(Foreign.prototype), Object.setPrototypeOf(new Foreign(), null),
    new CrossRealm(), runInNewContext("[[], new Date(0), new Map(), new Error('x')]")[0],
    ...runInNewContext("[new Date(0), new Map(), new Error('x')]"),
    {_tag: "TaggedBase"}, new TaggedSub(), null, 1]
}
