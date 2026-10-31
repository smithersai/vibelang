import { expect, test } from "bun:test"
import { $extract, $is } from "../src/match.js"

// VIP-7/detail67a uses native instanceof, including forged or replaced prototypes.
test("Date patterns follow the current prototype chain", () => {
  const forged = Object.create(Date.prototype)
  expect($is(Date, forged)).toBe(true)
  expect($extract(Date, forged)).toEqual([forged])
  const real = new Date(NaN)
  expect($is(Date, real)).toBe(true)
  expect($extract(Date, real)).toEqual([real])
  const moved = Object.setPrototypeOf(new Date(0), Object.prototype)
  expect($is(Date, moved)).toBe(false)
  expect($extract(Date, moved)).toBe(false)
  class SubDate extends Date {}
  expect($is(Date, new SubDate())).toBe(true)
})
