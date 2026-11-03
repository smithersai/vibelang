package vibelang

import (
	"fmt"
	"testing"
)

// VIP-1 assigns EK0102 to await using in Effect code, independently of
// resource type and without crossing a nested source callable boundary.
func TestAwaitUsingPlacement(t *testing.T) {
	contexts := []struct {
		name, source string
		want         int
	}{
		{"function", "effect function f() { %s }", 1},
		{"expression", "const f = effect function () { %s }", 1},
		{"arrow", "const f = effect () => { %s }", 1},
		{"block", "const f = effect { %s }", 1},
		{"producer", "effect function* f() { %s; yield 1 }", 1},
		{"object-method", "const o = { effect f() { %s } }", 1},
		{"class-method", "class C { effect f() { %s } }", 1},
		{"region", "effect function f() { uninterruptible { %s } }", 1},
		{"loop-body", "effect function f() { for (const x of [1]) { %s } }", 1},
		{"loop-head", "effect function f() { for (%s of [resource]) {} }", 1},
		{"do", "effect function f() { const x = do { %s; 1 } }", 1},
		{"nested-effect", "async function outer() { effect function f() { %s } }", 1},
		{"async", "async function f() { %s }", 0},
		{"async-arrow", "const f = async () => { %s }", 0},
		{"nested-async", "effect function outer() { async function f() { %s } }", 0},
		{"nested-async-arrow", "effect function outer() { const f = async () => { %s } }", 0},
		{"async-method", "effect function outer() { const o = { async f() { %s } } }", 0},
		{"native-generator", "async function* f(): AsyncGenerator<number> { %s; yield 1 }", 0},
		{"sync-using", "effect function f() { using r = { [Symbol.dispose]() {} } }", 0},
	}
	for _, context := range contexts {
		t.Run(context.name, func(t *testing.T) {
			declaration := "await /* disposal 😀 */ using r = resource"
			if context.name == "loop-head" {
				declaration = "await using r"
			}
			source := "declare const resource: AsyncDisposable;"
			if context.name == "sync-using" {
				source += context.source
			} else {
				source += fmt.Sprintf(context.source, declaration)
			}
			program, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Source() != diagnosticSource {
					continue
				}
				switch d.Code() {
				case EK0102.Code:
					count++
					if got := file.Text()[d.Pos():d.End()]; got != "await" {
						t.Errorf("placement span = %q, want await", got)
					}
				case EK1003.Code:
					t.Errorf("legacy await using diagnostic: %s", d.String())
				}
			}
			if count != context.want {
				t.Errorf("EK0102 count = %d, want %d; source: %s", count, context.want, source)
			}
		})
	}
}
