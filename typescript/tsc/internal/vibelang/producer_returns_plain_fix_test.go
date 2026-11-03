package vibelang

import (
	"path/filepath"
	"strings"
	"testing"
)

// A plain function* is a JavaScript generator (VIP-21), whose caller reads its
// return value through next() or yield*. Opencode packages/codemode/src/data
// lost 8 such values to `{ value; return }`, with nothing to flag it. --fix
// leaves the return, and the program keeps reporting EK2128 until the plain
// generator is admitted or the function is marked effect.
func TestProducerReturnPlainGeneratorFixKeepsValue(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"declaration read by next", `function* g(n: number) {
  yield n
  return n + 1
}
export const last = () => {
  const it: any = g(1)
  it.next()
  return it.next().value
}
`},
		{"expression", `export const g = function* (n: number) {
  yield n
  return n + 1
}
`},
		{"alias of Generator", `type Eval<T> = Generator<number, T, unknown>
export const g = function* (n: number): Eval<number> {
  yield n
  return n + 1
}
`},
		{"read by yield*", `function* inner(n: number) {
  yield n
  return n + 1
}
export const outer: any = function* (): Generator<number, number, unknown> {
  const x: any = yield* (inner(1) as any)
  return x
}
`},
		{"passed through a variable", `declare const drive: (f: unknown) => number
const body = function* () {
  return 1 + 1
}
export const value = drive(body)
`},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, file, _, _ := editorProgramWith(t, test.source, map[string]string{})
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if fixed := result.Files[file.FileName()]; fixed != nil && fixed.Counts[EK2128.Code] != 0 {
				t.Fatalf("--fix rewrote a plain generator return:\n%s", fixed.Text)
			}
		})
	}
}

// A function marked effect is a producer by its own word, and its Stream has no
// return value to read, so the fix still applies and keeps the evaluation.
func TestProducerReturnEffectFixStillApplies(t *testing.T) {
	_, file, _, _ := editorProgramWith(t, "export effect function* p(n: number) {\n  yield n\n  return n + 1\n}\n", map[string]string{})
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Counts[EK2128.Code] != 1 || !strings.Contains(fixed.Text, "{ n + 1; return }") {
		t.Fatalf("fix not applied: %+v", fixed)
	}
}
