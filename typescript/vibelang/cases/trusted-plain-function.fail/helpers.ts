// trusted(impl, [Errors]) returns one plain function (D514).
import { Data } from "effect"
import { trusted } from "vibelang-runtime"

export class BadNumber extends Data.TaggedError("BadNumber")<{ readonly text: string }> {}

function parseImpl(text: string): number {
  const n = Number(text)
  if (Number.isNaN(n)) throw new BadNumber({ text })
  return n
}

export const parse = trusted(parseImpl, [BadNumber])
export const slugify = trusted((s: string): string => s.trim().toLowerCase().replace(/ +/g, "-"), [])

/** A TypeScript caller receives a function of impl's type. */
export const fromTypeScript = trusted((): string => typeof parse("42"), [])
