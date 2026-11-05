import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { serviceShapeAdviceProblems, userServiceShapeProblems } from "./service-shape-scopes.mjs"

test("whole-shape service prose states the alias scope", () => {
  expect(userServiceShapeProblems()).toEqual([])
})

test("the whole-shape cheat sheet gives an external implementation type", () => {
  const text = readFileSync(new URL("../user/src/vibelang-features/115-cheat-sheet.md", import.meta.url), "utf8")
  expect(serviceShapeAdviceProblems(text, "cheat-sheet")).toEqual([])
  expect(text).toContain("Context.Service.Shape<typeof Name>")
})

test("generated whole-shape advice distinguishes body aliases from external types", () => {
  const tick = String.fromCharCode(96), code = (text: string) => tick + text + tick
  fc.assert(fc.property(
    fc.constantFrom("Search", "Port", "Settings", "_Local", "$Token"),
    fc.constantFrom("string", "SearchApi", "Readonly<{ value: string }>", "() => number"),
    fc.constantFrom("resolves to", "denotes", "names", "is an alias for"),
    fc.constantFrom("", " ", "  "),
    (name, shape, verb, space) => {
      const form = code("service " + name + space + ": " + shape + " { }")
      const alias = code(name + space + "." + space + "Shape")
      const claim = alias + " " + verb + " the written type."
      const text = form + " has a required body. " + claim
      expect(serviceShapeAdviceProblems(text, "generated")).toHaveLength(1)
      expect(serviceShapeAdviceProblems(form + " has a required body. Inside that body, " + claim, "generated")).toEqual([])
      expect(serviceShapeAdviceProblems(form + " has a required body. Within its own body, " + claim + " Outside, use " + code("Context.Service.Shape<typeof " + name + ">") + ".", "generated")).toEqual([])
      expect(serviceShapeAdviceProblems(form + " has a required body. Outside, name " + code(shape) + " or " + code("Context.Service.Shape<typeof " + name + ">") + ".", "generated")).toEqual([])
      expect(serviceShapeAdviceProblems(form + " has a required body. " + alias + " does not resolve outside it.", "generated")).toEqual([])
      expect(serviceShapeAdviceProblems(code("service " + name + " { value: string }") + " declares members. " + claim, "generated")).toEqual([])
      expect(serviceShapeAdviceProblems(tick.repeat(3) + "md" + "\n" + text + "\n" + tick.repeat(3), "generated")).toEqual([])
      expect(serviceShapeAdviceProblems("> " + text, "generated")).toHaveLength(1)
    }
  ), { numRuns: 200, seed: 37037 })
})
