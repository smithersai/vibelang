package vibelangmapper

import (
	"strings"
	"testing"

	"gotest.tools/v3/assert"
)

// VIP-43: the TypeScript 7 mapper erases spec functions and proof blocks
// from both renderings, so a file with them emits the JavaScript of the same
// file without them and projects no proof syntax for TypeScript to reject.
func TestProofSyntaxErases(t *testing.T) {
	count := "export function count(xs: readonly boolean[]): number {\n%s  let total = 0\n  for (let i = 0; i < xs.length; i++) {\n%s    if (xs[i]) total++\n  }\n  return total\n}\n"
	countPrefix := "spec function countPrefix(xs: readonly boolean[], end: number): number {\n  proof {\n    assume(0 <= end && end <= xs.length)\n    ensures((r) => 0 <= r && r <= end)\n    decreases(end)\n  }\n  if (end <= 0) return 0\n  return countPrefix(xs, end - 1) + (xs[end - 1] ? 1 : 0)\n}\n"
	fill := func(format string, a ...string) string {
		for _, s := range a {
			format = strings.Replace(format, "%s", s, 1)
		}
		return format
	}
	for _, c := range []struct{ name, with, without string }{
		{
			name: "spec function and proof blocks",
			with: countPrefix + fill(count,
				"  proof {\n    ensures((r) => r === countPrefix(xs, xs.length))\n  }\n",
				"    proof {\n      invariant(total === countPrefix(xs, i))\n      decreases(xs.length - i)\n    }\n"),
			without: fill(count, "", ""),
		},
		{
			name:    "a proof block before a statement that starts with [",
			with:    "export function f(n: number): number {\n  let a = n\n  proof {\n    assert(a === n)\n  }\n  ;[a].forEach((x) => x)\n  return a\n}\n",
			without: "export function f(n: number): number {\n  let a = n\n  ;[a].forEach((x) => x)\n  return a\n}\n",
		},
		{
			name:    "a proof block ends the statement before it",
			with:    "export function f(n: number): number {\n  let a = n\n  proof {\n    assert(a === n)\n  }\n  (globalThis as any).seen = a\n  return a\n}\n",
			without: "export function f(n: number): number {\n  let a = n;\n  (globalThis as any).seen = a\n  return a\n}\n",
		},
		{
			name:    "modifiers and an effect spec function erase with it",
			with:    "export spec function exported(n: number): number { return n }\nspec effect function running(n: number) { return n }\nexport const one = 1\n",
			without: "export const one = 1\n",
		},
		{
			name:    "an import used only by proofs",
			with:    "import { helper } from \"./helper.js\"\nspec function lifted(n: number): number {\n  return helper(n)\n}\nexport function f(n: number): number {\n  proof {\n    ensures((r) => lifted(r) === lifted(r))\n  }\n  return n\n}\n",
			without: "import { helper } from \"./helper.js\"\nexport function f(n: number): number {\n  return n\n}\n",
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			js, _, diagnostics := Emit(c.with, testContext)
			assert.Equal(t, len(diagnostics), 0, "%+v", diagnostics)
			want, _, _ := Emit(c.without, testContext)
			assert.Equal(t, js, want)
			projection := Project(c.with, testContext)
			assert.Equal(t, len(projection.Diagnostics), 0, "%+v", projection.Diagnostics)
			for _, word := range []string{"spec", "proof", "assume", "assert", "ensures", "invariant", "decreases", "countPrefix", "lifted"} {
				assert.Assert(t, !strings.Contains(projection.Text, word), "the projection holds %q:\n%s", word, projection.Text)
			}
			for _, f := range projection.Purity {
				assert.Assert(t, f.Name != "countPrefix" && f.Name != "exported" && f.Name != "running" && f.Name != "lifted", "purity fact for erased %s", f.Name)
			}
		})
	}
}
