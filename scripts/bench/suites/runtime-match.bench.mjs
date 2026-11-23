#!/usr/bin/env node
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const rt = await import(path.join(root, "packages/runtime/dist/index.js"))
const { $is, $extract, $rest, $relation, $matchCache, customMatcher, $registerErrorMatcher } = rt

class Widget {
  constructor(id) { this.id = id }
  describe() { return `widget:${this.id}` }
}
class SubWidget extends Widget {}

class FakeError {
  constructor(tag, id) { this._tag = tag; this.id = id }
  static [customMatcher] = $registerErrorMatcher(function (subject) {
    return subject !== null && typeof subject === "object" && subject._tag === "FakeError"
  })
}

const isPositive = (x) => typeof x === "number" && x > 0
const customExtractor = {
  [customMatcher](subject, hint) {
    if (hint.matchType === "boolean") return typeof subject === "object" && subject !== null && "x" in subject
    return typeof subject === "object" && subject !== null && "x" in subject ? [subject.x, subject.y] : false
  }
}

const widget = new Widget(1)
const subWidget = new SubWidget(2)
const fakeErr = new FakeError("FakeError", "e1")
const re = /^user-(\d+)-([a-z]+)$/
const smallObj = { a: 1, b: 2, c: 3, d: 4 }
const wideObj = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`k${i}`, i]))
const point = { x: 10, y: 20 }
const arr = [1, 2, 3, 4]

await runSuite({
  suite: "runtime-match",
  category: "runtime",
  description: "Pattern matching runtime helpers ($is, $extract, $rest, $relation, $matchCache).",
  cases: [
    {
      name: "$is(primitive literal)",
      unit: "ns/op",
      fn: () => $is(42, 42),
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$is(String builtin)",
      unit: "ns/op",
      fn: () => $is(String, "hello"),
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$is(Array builtin)",
      unit: "ns/op",
      fn: () => $is(Array, arr),
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$is(class, default dispatch)",
      unit: "ns/op",
      fn: () => $is(Widget, widget),
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$is(class, construct dispatch)",
      unit: "ns/op",
      fn: () => $is(Widget, subWidget, null, false, "construct"),
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$is(predicate fn, default dispatch)",
      unit: "ns/op",
      fn: () => $is(isPositive, 7),
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$is(error family customMatcher)",
      unit: "ns/op",
      fn: () => $is(FakeError, fakeErr),
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$is(RegExp)",
      unit: "ns/op",
      fn: () => $is(re, "user-42-alice"),
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$extract(customMatcher)",
      unit: "ns/op",
      fn: () => $extract(customExtractor, point),
      verify: (v) => assert.deepEqual(v, [10, 20])
    },
    {
      name: "$extract(RegExp)",
      unit: "ns/op",
      fn: () => $extract(re, "user-42-alice"),
      verify: (v) => assert.equal(v[0][1], "42")
    },
    {
      name: "$extract(Array)",
      unit: "ns/op",
      fn: () => $extract(Array, arr),
      verify: (v) => assert.equal(v.length, 4)
    },
    {
      name: "$rest(4-key obj, omit 2)",
      unit: "ns/op",
      fn: () => $rest(smallObj, ["a", "b"]),
      verify: (v) => assert.deepEqual(v, { c: 3, d: 4 })
    },
    {
      name: "$rest(24-key obj, omit 4)",
      unit: "ns/op",
      fn: () => $rest(wideObj, ["k0", "k5", "k10", "k15"]),
      verify: (v) => assert.equal(Object.keys(v).length, 20)
    },
    {
      name: "$relation(< number)",
      unit: "ns/op",
      fn: () => $relation("<", 10, 20),
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$matchCache(lifecycle, no-op)",
      unit: "ns/op",
      fn: () => {
        const c = $matchCache()
        c.finish()
        return true
      },
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$matchCache(propertyHas + get + finish)",
      unit: "ns/op",
      fn: () => {
        const c = $matchCache()
        const h = c.propertyHas(smallObj, "a")
        const v = c.get(smallObj, "a")
        c.finish()
        return h && v === 1
      },
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$matchCache(iterable 4 items)",
      unit: "ns/op",
      fn: () => {
        const c = $matchCache()
        c.iterable(arr)
        c.has(arr, 3)
        const v = c.at(arr, 3)
        c.finish()
        return v
      },
      verify: (v) => assert.equal(v, 4)
    }
  ]
})
