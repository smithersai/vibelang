import { expect, test } from "bun:test"
import { $extract, $is } from "../src/match.js"

test("Date patterns require the Date internal slot", () => {
  const forged = Object.create(Date.prototype)
  expect($is(Date, forged)).toBe(false)
  expect($extract(Date, forged)).toBe(false)
  const real = new Date(NaN)
  expect($is(Date, real)).toBe(true)
  expect($extract(Date, real)).toEqual([real])
  class SubDate extends Date {}
  expect($is(Date, new SubDate())).toBe(true)
})
