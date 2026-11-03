import assert from "node:assert/strict"
import { KeyFormat } from "effect/crypto"
import { Transferable } from "effect/workers"
import { foreign, collect, nested, valueShadow } from "./out/main.js"
assert.equal(foreign, KeyFormat.jwk)
assert.equal(collect, Transferable.makeCollectorUnsafe)
assert.deepEqual(nested(), { local: { nested: true }, foreign: KeyFormat.jwk })
assert.equal(valueShadow(), "local")
const { succeedKind, someKind } = await import("./out/root.js")
assert.equal(succeedKind, "function")
assert.equal(someKind, "function")
console.log("local type namespaces ok")
