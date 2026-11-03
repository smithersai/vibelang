package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 004: the coverage domain is the type at evaluation, not the
// declaration's wider type. Coverage must still leave source flow untouched.
func TestMatchFlowRefinedSubjectDomain(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		missing      bool
	}{
		{"boolean", `export function f(x: boolean | number) { if (typeof x !== "boolean") return 0; return match(x){when true:1;}; }`, true},
		{"unknown", `export function f(x: unknown) { if (typeof x !== "boolean") return 0; return match(x){when true:1;}; }`, true},
		{"undefined", `export function f(x: string | undefined) { if (x !== undefined) return 0; return match(x){when undefined and if(false):1;}; }`, true},
		{"property", `export function f(b: {value:boolean|number}) { if(typeof b.value !== "boolean") return 0; return match(b.value){when true:1;}; }`, true},
		{"element", `export function f(b: {value:boolean|number}) { if(typeof b["value"] !== "boolean") return 0; return match(b["value"]){when true:1;}; }`, true},
		{"parenthesized", `export function f(x: boolean | number) { if(typeof x !== "boolean") return 0; return match((x)){when true:1;}; }`, true},
		{"assignment", `export function f() { let x: boolean | number = false; return match(x){when false and if(false):1;}; }`, true},
		{"effect", `export effect function f(x: boolean | number) { if(typeof x !== "boolean") return 0; return match(x){when true:1;}; }`, true},
		{"tagged-intersection", `export function f(x:{_tag:"A"}|{_tag:"B"}) { if("extra" in x) return match(x){when {_tag:"A"}:1;}; return 0; }`, true},
		{"tagged-intersection-complete", `export function f(x:{_tag:"A"}|{_tag:"B"}) { if("extra" in x) return match(x){when {_tag:"A"}:1;when {_tag:"B"}:0;}; return 0; }`, false},
		{"shared-tag-intersection", `export function f(x:({_tag:"A";a:1}|{_tag:"A";b:2})&{extra:true}) { return match(x){when {_tag:"A"}:1;}; }`, false},
		{"union-tag-intersection", `export function f(x:{_tag:"A"|"B"}&{extra:true}) { return match(x){when {_tag:"A"}:1;when {_tag:"B"}:0;}; }`, false},
		{"complete", `export function f(x: boolean | number) { if(typeof x !== "boolean") return 0; return match(x){when true:(x satisfies true)?1:1; when false:(x satisfies false)?0:0;}; }`, false},
		{"open", `export function f(x: boolean | number) { return match(x){when true:1;}; }`, false},
		{"default", `export function f(x: boolean | number) { if(typeof x !== "boolean") return 0; return match(x){when true:1;default:(x satisfies false)?0:0;}; }`, false},
		{"widened", `export function f(x:boolean|number,n:number) { if(typeof x !== "boolean") return 0; x=n; return match(x){when let v and if(false):1;}; }`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			missing := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == "EK" && d.Code() == EK4701.Code {
					missing++
					continue
				}
				t.Errorf("unexpected diagnostic: %s", d.String())
			}
			want := 0
			if tc.missing {
				want = 1
			}
			if missing != want {
				t.Fatalf("EK4701 count = %d, want %d", missing, want)
			}
		})
	}
}
