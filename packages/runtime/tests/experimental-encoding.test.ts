import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import * as Result from "effect/Result"
import { Base64, Base64Url } from "effect/encoding"
import * as fc from "fast-check"
import { Encoding } from "vibelang-runtime/experimental"

const decode = (input: string) => Array.from(Result.getOrThrow(Encoding.decodeBase64Lenient(input)))
const oracle = (inputs: string[]): number[][] => JSON.parse(execFileSync("node", ["-e", `
  let text = ""; process.stdin.setEncoding("utf8");
  process.stdin.on("data", c => text += c);
  process.stdin.on("end", () => process.stdout.write(JSON.stringify(
    JSON.parse(text).map(s => Array.from(Buffer.from(s, "base64")))
  )));
`], { input: JSON.stringify(inputs), encoding: "utf8" }))

test("Effect's strict decoders do not cover Buffer's whitespace, padding and alphabet variants", () => {
  for (const input of ["Z g==", "Z\tg==", "Zg", "-/8=", "Zg====", "Zg==ignored"]) {
    expect(Result.isFailure(Base64.decode(input)) && Result.isFailure(Base64Url.decode(input)) ||
      input === "Zg" && Result.isFailure(Base64.decode(input))).toBe(true)
    expect(decode(input)).toEqual(oracle([input])[0])
  }
})

test("lenient base64 matches Node over generated whitespace, padding, mixed alphabets and junk", () => {
  const variant = fc.tuple(fc.uint8Array({ maxLength: 90 }), fc.boolean(), fc.integer({ min: 0, max: 7 }),
    fc.constantFrom(" ", "\t", "\n", "\r\n", "\v", "\f", "!$?"),
    fc.boolean()).map(([bytes, url, padding, space, tail]) => {
      let text = Buffer.from(bytes).toString("base64").replace(/=/g, "")
      if (url) text = text.replace(/\+/g, "-").replace(/\//g, "_")
      return space + text.split("").join(space) + "=".repeat(padding) + (tail ? "=ignored" : "")
    })
  fc.assert(fc.property(fc.array(variant, { minLength: 1, maxLength: 20 }), (inputs) => {
    expect(inputs.map(decode)).toEqual(oracle(inputs))
  }), { seed: 3302, numRuns: 100 })
})

test("arbitrary UTF-16 strings, early padding and lone sextets match Node without throwing", () => {
  const text = fc.array(fc.integer({ min: 0, max: 65535 }), { maxLength: 100 })
    .map((codes) => String.fromCharCode(...codes))
  fc.assert(fc.property(fc.array(text, { minLength: 1, maxLength: 20 }), (inputs) => {
    expect(inputs.map(decode)).toEqual(oracle(inputs))
  }), { seed: 3303, numRuns: 100 })
  const inputs = ["", "a", "ab", "abc", "abcdx", "=abcd", "ab=c", "ab===",
    "\u0141\u0142\u0143\u0144", "Zm9v!bar", "_+/-"]
  expect(inputs.map(decode)).toEqual(oracle(inputs))
})
