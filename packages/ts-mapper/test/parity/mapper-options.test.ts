import { expect, test } from "bun:test"
import { mapperEntry } from "./mapper-options"
test("mapper entries contain no automatic tracing option", () => {
  for (const config of [{}, { vibelang: { tracing: "all" } }]) {
    expect(mapperEntry(config)).toEqual({ package: "vibelang-ts-mapper", extensions: [".vibe"] })
  }
})
