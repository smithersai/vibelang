package vibelangestree

import "testing"

// A do expression lowers to `let $do1; { …; $do1 = value }`. The tree called
// that list const, as it does a pattern binding the parser wrote, so ESLint's
// no-const-assign reported a name the author never wrote: 10 times over t3code's
// 452 .vibe files. An author's pattern binding stays const.
func TestDoCompletionTemporaryIsLet(t *testing.T) {
	declarationKinds := func(tree map[string]any, name string) []string {
		var kinds []string
		for _, declaration := range find(tree, "VariableDeclaration") {
			for _, declarator := range declaration["declarations"].([]any) {
				id, _ := declarator.(map[string]any)["id"].(map[string]any)
				if id["name"] == name {
					kinds = append(kinds, declaration["kind"].(string))
				}
			}
		}
		return kinds
	}
	tree := parse(t, "test.vibe", "export const h = (n: number): number => do { const a = n + 1; a * 2 }")
	if kinds := declarationKinds(tree, "$do1"); len(kinds) != 1 || kinds[0] != "let" {
		t.Fatalf("$do1 declared as %v; want [let]", kinds)
	}
	if kinds := declarationKinds(tree, "a"); len(kinds) != 1 || kinds[0] != "const" {
		t.Fatalf("a declared as %v; want [const]", kinds)
	}
	bound := parse(t, "test.vibe", "function f(x) { if (x is Exit.Failure(let cause)) return cause }")
	if kinds := declarationKinds(bound, "cause"); len(kinds) == 0 || kinds[0] != "const" {
		t.Fatalf("pattern binding declared as %v; want const", kinds)
	}
}
