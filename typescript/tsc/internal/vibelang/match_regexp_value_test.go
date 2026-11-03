package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The global RegExp interface is accepted independently of local constructor
// names. Non-callable objects, any and unknown keep their admission errors.
func TestRegExpPatternValueAdmission(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		invalid      bool
	}{
		{"constant", `const r=/a/;export function f(x:unknown){return x is r}`, false},
		{"constructor", `const r=new RegExp("a");export function f(x:unknown){return x is r}`, false},
		{"parameter", `export function f(x:unknown,r:RegExp){return x is r}`, false},
		{"property", `export function f(x:unknown,b:{r:RegExp}){return x is b.r}`, false},
		{"element", `export function f(x:unknown,b:{r:RegExp}){return x is b["r"]}`, false},
		{"alias", `type R=RegExp;export function f(x:unknown,r:R){return x is r}`, false},
		{"subclass", `class R extends RegExp{}const r=new R("a");export function f(x:unknown){return x is r}`, false},
		{"extractor", `const r=/a/;export function f(x:unknown){return match(x){when r(let m):m satisfies RegExpMatchArray;default:null;}}`, false},
		{"object", `const r={test(){return true}};export function f(x:unknown){return x is r}`, true},
		{"any", `export function f(x:unknown,r:any){return x is r}`, true},
		{"unknown", `export function f(x:unknown,r:unknown){return x is r}`, true},
		{"shadow", `class RegExp{}const r=new RegExp();export function f(x:unknown){return x is r}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() != "EK" || d.Code() != 702 {
					t.Errorf("unexpected diagnostic: %s", d.String())
					continue
				}
				count++
			}
			want := 0
			if tc.invalid {
				want = 1
			}
			if count != want {
				t.Fatalf("EK0702 count = %d, want %d", count, want)
			}
		})
	}
}
