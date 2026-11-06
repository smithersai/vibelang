import { expect, test } from "bun:test"
import { withNodeOracle } from "./node-oracle"
import * as Result from "effect/Result"
import { Base64, Base64Url } from "effect/encoding"
import * as fc from "fast-check"
import { Encoding } from "vibelang-runtime/experimental"

const decode = (input: string) => Array.from(Result.getOrThrow(Encoding.decodeBase64Lenient(input)))

test("Effect's strict decoders do not cover Buffer's whitespace, padding and alphabet variants", async () => withNodeOracle<number[]>("base64", async (oracle) => {
  for (const input of ["Z g==", "Z\tg==", "Zg", "-/8=", "Zg====", "Zg==ignored"]) {
    expect(Result.isFailure(Base64.decode(input)) && Result.isFailure(Base64Url.decode(input)) ||
      input === "Zg" && Result.isFailure(Base64.decode(input))).toBe(true)
    expect(decode(input)).toEqual((await oracle([input]))[0])
  }
}))

test("lenient base64 matches Node over generated whitespace, padding, mixed alphabets and junk", async () => withNodeOracle<number[]>("base64", async (oracle) => {
  const variant = fc.tuple(fc.uint8Array({ maxLength: 90 }), fc.boolean(), fc.integer({ min: 0, max: 7 }),
    fc.constantFrom(" ", "\t", "\n", "\r\n", "\v", "\f", "!$?"),
    fc.boolean()).map(([bytes, url, padding, space, tail]) => {
      let text = Buffer.from(bytes).toString("base64").replace(/=/g, "")
      if (url) text = text.replace(/\+/g, "-").replace(/\//g, "_")
      return space + text.split("").join(space) + "=".repeat(padding) + (tail ? "=ignored" : "")
    })
  await fc.assert(fc.asyncProperty(fc.array(variant, { minLength: 1, maxLength: 20 }), async (inputs) => {
    expect(inputs.map(decode)).toEqual(await oracle(inputs))
  }), { seed: 3302, numRuns: 100 })
}))

test("arbitrary UTF-16 strings, early padding and lone sextets match Node without throwing", async () => withNodeOracle<number[]>("base64", async (oracle) => {
  const text = fc.array(fc.integer({ min: 0, max: 65535 }), { maxLength: 100 })
    .map((codes) => String.fromCharCode(...codes))
  await fc.assert(fc.asyncProperty(fc.array(text, { minLength: 1, maxLength: 20 }), async (inputs) => {
    expect(inputs.map(decode)).toEqual(await oracle(inputs))
  }), { seed: 3303, numRuns: 100 })
  const inputs = ["", "a", "ab", "abc", "abcdx", "=abcd", "ab=c", "ab===",
    "\u0141\u0142\u0143\u0144", "Zm9v!bar", "_+/-"]
  expect(inputs.map(decode)).toEqual(await oracle(inputs))
}))
