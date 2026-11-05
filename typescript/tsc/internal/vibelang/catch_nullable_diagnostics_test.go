package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestCatchNullableHeadKeepsIndependentDiagnostics(t *testing.T) {
	for _, row := range []struct {
		name, decl, left, handler, span string
		native                          int32
	}{
		{"undefined", "declare const p: Effect.Effect<number> | undefined;", "p", "() => 0", "", 0},
		{"null", "declare const p: Effect.Effect<number> | null;", "p", "() => 0", "", 0},
		{"both", "declare const p: Effect.Effect<number> | null | undefined;", "p", "() => 0", "", 0},
		{"parenthesized", "declare const p: Effect.Effect<number> | undefined;", "(p)", "() => 0", "", 0},
		{"asserted", "declare const p: unknown;", "(p as Effect.Effect<number> | undefined)", "() => 0", "", 0},
		{"satisfies", "declare const p: Effect.Effect<number> | undefined;", "p satisfies Effect.Effect<number> | undefined", "() => 0", "", 0},
		{"property", "declare const box: { p?: Effect.Effect<number> };", "box.p", "() => 0", "", 0},
		{"element", "declare const box: Record<string, Effect.Effect<number> | undefined>;", "box[\"p\"]", "() => 0", "", 0},
		{"call", "declare function p(): Effect.Effect<number> | undefined;", "p()", "() => 0", "", 0},
		{"optional-call", "declare const p: (() => Effect.Effect<number>) | undefined;", "p?.()", "() => 0", "", 0},
		{"handler", "declare const p: Effect.Effect<number> | undefined;", "p", "() => { const n:number = \"bad\"; return n }", "n", 2322},
		{"argument-property", "declare function p(x:{value:number}): Effect.Effect<number> | undefined;", "p({value:\"bad\"})", "() => 0", "value", 2322},
		{"argument", "declare function p(x:number): Effect.Effect<number> | undefined;", "p(\"bad\")", "() => 0", "\"bad\"", 2345},
		{"satisfaction-error", "declare const p: Effect.Effect<number> | undefined;", "p satisfies string", "() => 0", "satisfies", 1360},
		{"source-assignment", "let target:number;", "(target = \"bad\")", "() => 0", "target", 2322},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := "import { Effect } from \"effect\"; " + row.decl + "\nexport effect function main(){ return " + row.left + " catch " + row.handler + " }"
			program, file, _, _ := editorProgram(t, source)
			outer, inner := 0, 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				switch {
				case d.Code() == 506:
					outer++
				case row.native != 0 && d.Source() == "" && d.Code() == row.native && strings.Contains(source[d.Pos():d.End()], row.span):
					inner++
				default:
					t.Errorf("unexpected diagnostic %d [%d,%d] %q: %s", d.Code(), d.Pos(), d.End(), source[d.Pos():d.End()], d.String())
				}
			}
			wantInner := 0
			if row.native != 0 {
				wantInner = 1
			}
			if outer != 1 || inner != wantInner {
				t.Fatalf("want one EK0506 and native TS%d, got outer=%d inner=%d", row.native, outer, inner)
			}
		})
	}
}
