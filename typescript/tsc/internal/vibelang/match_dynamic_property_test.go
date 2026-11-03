package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func dynamicPropertyCodes(t *testing.T, source string) []string {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	var got []string
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		prefix := d.Source()
		if prefix == "" {
			prefix = "TS"
		}
		got = append(got, fmt.Sprintf("%s%04d", prefix, d.Code()))
	}
	return got
}
func TestUnknownDynamicPatternProperty(t *testing.T) {
	for _, decl := range []string{
		"declare const key:string;", "declare const key:number;", "declare const key:symbol;",
		"declare const key:string|number;", "declare const key:'a'|'b';", "declare const key:PropertyKey;",
	} {
		for _, source := range []string{
			"function f(x:unknown){return match(x){when {[key]:let value}:value;default:0;}}",
			"function f(x:unknown){if(x is {[key]:let value})return value;return 0}",
			"function f(x:unknown){return match(x){when {child:{[key]:let value}}:value;default:0;}}",
		} {
			if got := dynamicPropertyCodes(t, decl+source); len(got) != 0 {
				t.Fatalf("unknown extraction: %v; source=%s", got, decl+source)
			}
		}
	}
}
func TestUnknownDynamicPatternPropertyStaysUnknown(t *testing.T) {
	source := "const names={field:'field'};function f(x:unknown){return match(x){when {[names.field]:let value}:do{const n:number=value;n};default:0;}}"
	got := dynamicPropertyCodes(t, source)
	if len(got) != 1 || got[0] != "TS2322" {
		t.Fatalf("unknown binding codes %v, want [TS2322]", got)
	}
}
func TestUnknownDynamicPatternPropertyControls(t *testing.T) {
	for _, source := range []string{
		"function f(x:Record<string,number>,key:string){return match(x){when {[key]:let value}:do{const n:number=value;n};default:0;}}",
		"function f(x:any,key:string){return match(x){when {[key]:let value}:do{const n:number=value;n};default:0;}}",
		"function f(x:{field:number}){return match(x){when {field:let value}:do{const n:number=value;n};default:0;}}",
	} {
		if got := dynamicPropertyCodes(t, source); len(got) != 0 {
			t.Fatalf("control: %v; source=%s", got, source)
		}
	}
	for _, source := range []string{
		"function f(x:unknown,key:string){if(typeof x==='object'&&x!==null&&key in x)return x[key];return 0}",
		"declare const names:{};function f(x:unknown){if(x is {[names['missing']]:let value})return value;return 0}",
	} {
		if got := dynamicPropertyCodes(t, source); !strings.Contains(strings.Join(got, ","), "TS7053") {
			t.Fatalf("lost native indexing diagnostic: %v; source=%s", got, source)
		}
	}
}
