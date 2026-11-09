package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestAndBindingLiteralNarrowing(t *testing.T) {
	rows := []struct{ name, subject, pattern, narrowed string }{
		{"literal-left", "string", `"spec" and let x`, `"spec"`},
		{"literal-right", "string", `let x and "spec"`, `"spec"`},
		{"union-left", "string", `("spec" or "tasks") and let x`, `"spec" | "tasks"`},
		{"union-right", "string", `let x and ("spec" or "tasks")`, `"spec" | "tasks"`},
		{"nested-and-left", "string", `(("spec" or "tasks") and let x) and "tasks"`, `"tasks"`},
		{"nested-and-right", "string", `("spec" or "tasks") and (let x and "tasks")`, `"tasks"`},
		{"nested-or-left", "string", `("spec" and let x) or ("tasks" and let x)`, `"spec" | "tasks"`},
		{"nested-or-right", "string", `(let x and "spec") or (let x and "tasks")`, `"spec" | "tasks"`},
		{"array-left", "string[]", `[("spec" or "tasks") and let x]`, `"spec" | "tasks"`},
		{"array-right", "string[]", `[let x and ("spec" or "tasks")]`, `"spec" | "tasks"`},
		{"array-literal-left", "string[]", `["spec" and let x]`, `"spec"`},
		{"array-literal-right", "string[]", `[let x and "spec"]`, `"spec"`},
		{"object-field-left", "{value:string}", `{value:("spec" or "tasks") and let x}`, `"spec" | "tasks"`},
		{"object-field-right", "{value:string}", `{value:let x and ("spec" or "tasks")}`, `"spec" | "tasks"`},
		{"object-left", `{_tag:"Square";side:number}|{_tag:"Circle";radius:number}`, `{_tag:"Square"} and let x`, `{_tag:"Square";side:number}`},
		{"object-right", `{_tag:"Square";side:number}|{_tag:"Circle";radius:number}`, `let x and {_tag:"Square"}`, `{_tag:"Square";side:number}`},

		{"object-or-left", `{_tag:"Square";side:number}|{_tag:"Rect";side:number}|{_tag:"Circle";radius:number}`, `{_tag:("Square" or "Rect")} and let x`, `{_tag:"Square";side:number}|{_tag:"Rect";side:number}`},
		{"object-or-right", `{_tag:"Square";side:number}|{_tag:"Rect";side:number}|{_tag:"Circle";radius:number}`, `let x and {_tag:("Square" or "Rect")}`, `{_tag:"Square";side:number}|{_tag:"Rect";side:number}`},
		{"nested-is-guard", "string", `let x and if(x is "spec")`, `"spec"`},
		{"constructor-right", "unknown", `let x and String`, "string | String"},
		{"number-left", "number", `(1 or 2) and let x`, "1 | 2"},
		{"number-right", "number", `let x and (1 or 2)`, "1 | 2"},
		{"boolean-right", "boolean", `let x and true`, "true"},
		{"non-narrowing-left", "string", `if(true) and let x`, "string"},
		{"non-narrowing-right", "string", `let x and if(true)`, "string"},
	}
	for _, row := range rows {
		for _, mode := range []string{"match", "is"} {
			t.Run(row.name+"/"+mode, func(t *testing.T) {
				check := "true satisfies Equal<typeof x, " + row.narrowed + ">"
				body := "return match(s) {when " + row.pattern + ": (" + check + ");default: false;}"
				if mode == "is" {
					body = "if(s is " + row.pattern + ") {return " + check + "} return false"
				}
				source := `type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;` +
					fmt.Sprintf("export function f(s:%s){%s}", row.subject, body)
				program, file, _, _ := editorProgram(t, source)
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("TS%d %s", d.Code(), d.String())
					}
				}
			})
		}
	}
}

func TestAndBindingSourceWrites(t *testing.T) {
	for _, source := range []string{
		`export function f(s:string):string{return match(s){when let x and if((x="changed",true)) and "spec":do{const exact:true=true satisfies Equal<typeof x,string>;x};default:"none";}}`,
		`export function f(s:string):string{return match(s){when let x and "spec":do{x="changed";const exact:true=true satisfies Equal<typeof x,string>;x};default:"none";}}`,
		`export function f(s:string):string{return match(s){when let x and if((s="changed",true)) and "spec":do{const exact:true=true satisfies Equal<typeof x,"spec">;x};default:"none";}}`,
	} {
		for _, d := range errorsOf(t, `type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;`+source) {
			t.Errorf("TS%d %s", d.Code(), d.String())
		}
	}
}

func TestAndBindingFreshSubjectInference(t *testing.T) {
	equal := `type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;`
	for _, row := range []struct{ value, pattern, expected string }{
		{"2", "let x and if(true)", "number"},
		{"2", "if(true) and let x", "number"},
		{"2", "let x and (let y and if(true))", "number"},
		{"2", "let x and if((true satisfies Equal<typeof x,number>,x===1))", "1"},
		{`"spec"`, "let x and if(true)", "string"},
		{`"spec"`, "if(true) and let x", "string"},
		{`"spec"`, `let x and if((true satisfies Equal<typeof x,string>,x==="tasks"))`, `"tasks"`},
	} {
		for _, mode := range []string{"match", "is"} {
			t.Run(row.value+"/"+row.pattern+"/"+mode, func(t *testing.T) {
				check := "true satisfies Equal<typeof x," + row.expected + ">"
				body := "return match(" + row.value + "){when " + row.pattern + ":(" + check + ");default:false;}"
				if mode == "is" {
					body = "if(" + row.value + " is " + row.pattern + "){return " + check + "}return false"
				}
				for _, d := range errorsOf(t, equal+"export function f(){"+body+"}") {
					t.Errorf("TS%d %s", d.Code(), d.String())
				}
			})
		}
	}
}
