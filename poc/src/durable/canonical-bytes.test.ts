import { expect, test } from "bun:test"
import { decodeCanonicalJson, encodeCanonicalJson } from "./value.ts"

const utf8 = new TextEncoder()

for (const json of ["null", "42", '"text"', "[]", '{"a":1}']) {
  test(`canonical UTF-8 ${json} refuses a byte-order mark without changing valid data`, () => {
    expect(decodeCanonicalJson(utf8.encode(json))).toEqual(JSON.parse(json))
    for (const malformed of ["\ufeff" + json, "\ufeff\ufeff" + json, " " + json, json + "\n"]) {
      expect(() => decodeCanonicalJson(malformed)).toThrow()
      expect(() => decodeCanonicalJson(utf8.encode(malformed))).toThrow()
    }
  })
}

test("a BOM code point inside JSON strings is data, not a forbidden byte prefix", () => {
  for (const value of ["\ufeff", "a\ufeffb", {"\ufeff": "\ufeff"}]) {
    const bytes = encodeCanonicalJson(value)
    expect(decodeCanonicalJson(bytes)).toEqual(value)
    const padded = new Uint8Array(bytes.length + 2)
    padded.set(bytes, 1)
    expect(decodeCanonicalJson(padded.subarray(1, -1))).toEqual(value)
  }
})

for (const [name, bytes] of [
  ["truncated UTF-8", [0x22, 0xc3, 0x22]],
  ["overlong UTF-8", [0x22, 0xc0, 0xaf, 0x22]],
  ["UTF-8 encoded surrogate", [0x22, 0xed, 0xa0, 0x80, 0x22]],
  ["UTF-16 LE BOM", [0xff, 0xfe, 0x6e, 0, 0x75, 0, 0x6c, 0, 0x6c, 0]],
  ["UTF-16 BE BOM", [0xfe, 0xff, 0, 0x6e, 0, 0x75, 0, 0x6c, 0, 0x6c]],
] as const) {
  test(`canonical UTF-8 refuses ${name} rather than repairing it`, () => {
    expect(() => decodeCanonicalJson(Uint8Array.from(bytes))).toThrow()
  })
}
