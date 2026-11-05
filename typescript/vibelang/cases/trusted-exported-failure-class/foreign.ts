import { trusted } from "vibelang-runtime"
export class Hidden extends Error {
  readonly _tag = "Hidden"
  private readonly brand = true
  constructor(message: string) { super(message) }
}
export const read = trusted((value = 0): number => {
  if (value) throw new Hidden("hidden")
  return 7
}, [Hidden])
