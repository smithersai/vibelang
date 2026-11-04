package vibelang

import (
	"strings"
	"testing"
)

func TestCatchNonEffectKeepsNestedDiagnostics(t *testing.T) {
	for _, row := range []struct {
		name, decl, left, handler, span string
		code                            int32
	}{
		{"argument", "declare function take(n:number):number;", "take(\"bad\")", "() => 0", "\"bad\"", 2345},
		{"nested-argument", "declare function take(n:number):number; declare function inner(n:number):number;", "take(inner(\"bad\"))", "() => 0", "\"bad\"", 2345},
		{"overload", "declare function take(n:number):number; declare function take(n:boolean):number;", "take(\"bad\")", "() => 0", "\"bad\"", 2769},
		{"handler-body", "declare function take(n:number):number;", "take(1)", "() => { const n:number = \"bad\"; return n }", "n", 2322},
		{"constraint", "declare function take<T extends number>(n:T):number;", "take<string>(\"bad\")", "() => 0", "string", 2344},
		{"argument-satisfies", "declare function take(n:number):number;", "take(\"bad\") satisfies number", "() => 0", "\"bad\"", 2345},
		{"satisfaction", "declare function take(n:number):number;", "take(1) satisfies string", "() => 0", "satisfies", 1360},
		{"object-property", "declare function take(n:{value:number}):number;", "take({value:\"bad\"})", "() => 0", "value", 2322},
		{"outer-only", "declare function take(n:number):number;", "take(1)", "() => 0", "", 0},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := row.decl + "\nexport effect function main(){ " + row.left + " catch " + row.handler + "; return 0 }"
			program, file, _, _ := editorProgram(t, source)
			outer, inner := 0, 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				switch {
				case d.Code() == 506:
					outer++
				case row.code != 0 && d.Code() == row.code:
					inner++
					if got := source[d.Pos():d.End()]; !strings.Contains(got, row.span) {
						t.Errorf("inner diagnostic span %q want %q", got, row.span)
					}
				default:
					t.Errorf("unexpected diagnostic %d: %s", d.Code(), d.String())
				}
			}
			if outer != 1 || (row.code != 0 && inner != 1) {
				t.Fatalf("want EK0506 and inner TS%d once, got outer=%d inner=%d", row.code, outer, inner)
			}
		})
	}
}
