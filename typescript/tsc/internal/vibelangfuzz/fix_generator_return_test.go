package vibelangfuzz

import (
	"maps"
	"slices"
)

const fixGeneratorReturnTarget = "FuzzFixGeneratorReturn"
const fixGeneratorReturnQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

// generatorShapes declare g, a plain function* of one number whose return value
// is what the driver reads.
var generatorShapes = map[string]string{
	"declaration": "function* g(n: number) {\n  yield n\n  return %VALUE%\n}\n",
	"expression":  "const g = function* (n: number) {\n  yield n\n  return %VALUE%\n}\n",
	"annotated":   "function* g(n: number): Generator<number, number, unknown> {\n  yield n\n  return %VALUE%\n}\n",
	"alias":       "type Eval<T> = Generator<number, T, unknown>\nconst g = function* (n: number): Eval<number> {\n  yield n\n  return %VALUE%\n}\n",
}

// generatorDrivers read the return value of g(1) as JavaScript callers do.
var generatorDrivers = map[string]string{
	"next":  "export const main = () => {\n  const it: any = g(1)\n  it.next()\n  return it.next().value\n}\n",
	"yield": "function* outer(): Generator<number, number, unknown> {\n  const x: any = yield* (g(1) as any)\n  return x + 100\n}\nexport const main = () => {\n  const it = outer()\n  it.next()\n  return it.next().value\n}\n",
}

var generatorValues = []string{"n + 1", "Math.max(n, 2)", "[n, 41].length"}

// fixGeneratorKeys returns m's keys in order, so a seed names one case on every run.
func fixGeneratorKeys(m map[string]string) []string {
	keys := slices.Collect(maps.Keys(m))
	slices.Sort(keys)
	return keys
}
