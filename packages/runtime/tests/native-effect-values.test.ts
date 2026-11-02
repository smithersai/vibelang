import { expect, test } from "bun:test"
import * as Runtime from "vibelang-runtime"

test("native interruption and yield values have no legacy runtime wrapper", () => {
  for (const name of ["interrupt", "yieldNow"]) expect(name in Runtime).toBe(false)
})
