package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestTryAssignmentGenericDefaults(t *testing.T) {
	for _, tc := range []struct {
		name, expression string
		code             int32
	}{
		{"absent", "try branch(create())", 0},
		{"explicit-undefined", "try branch(create(),undefined)", 0},
		{"supplied", "try branch(create(),()=>update())", 0},
		{"supplied-effect", "try branch(create(),effect()=>try update())", 0},
		{"supplied-nullable", "try branch(create(),()=>maybe())", 18048},
		{"dependent-absent", "try dependent(create())", 0},
		{"dependent-supplied", "try dependent(create(),()=>update())", 0},
		{"dependent-nullable", "try dependent(create(),()=>maybe())", 18048},
		{"actual-defaulted-branch-nullable", "try Effect.catchIf(create(),(e):e is {readonly _tag:\"Conflict\"}=>e._tag===\"Conflict\",()=>update(),()=>maybe())", 18048},
		{"actual-defaulted-branch-supplied", "try Effect.catchIf(create(),(e):e is {readonly _tag:\"Conflict\"}=>e._tag===\"Conflict\",()=>update(),()=>update())", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := tryAssignmentCallbackHeader + "interface Unset { readonly sentinel: unique symbol }\ndeclare const branch: <A,B=Unset>(self:Effect.Effect<A,Err>, recovery?:()=>Effect.Effect<B,Err>)=>Effect.Effect<A|Exclude<B,Unset>,Err>\ndeclare const dependent: <A,B=Unset,C=B>(self:Effect.Effect<A,Err>, recovery?:()=>Effect.Effect<B,Err>)=>Effect.Effect<A|Exclude<C,Unset>,Err>\n" + "export effect function caught(observed:Item|undefined){let current=observed;if(current===undefined){current=" + tc.expression + ";return current.id}return current.id}"
			p, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					if tc.code != 0 && d.Code() == tc.code {
						found = true
					} else {
						t.Errorf("unexpected diagnostic: %s", d.String())
					}
				}
			}
			if tc.code != 0 && !found {
				t.Errorf("missing TS%d", tc.code)
			}
		})
	}
}
func TestTryCallDefaultsAndProvidedValues(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		code       int32
	}{
		{"default-only", "declare const output:<T=number>()=>Effect.Effect<T>;export effect function checked(){const value:string=try output();return value}", 2322},
		{"provided-default", "declare const output:<T=number>(value:T)=>Effect.Effect<T>;export effect function checked(){const value:string=try output(\"provided\");return value}", 0},
		{"literal-context", "type Outcome={readonly _tag:\"Found\";readonly value:number}|{readonly _tag:\"Empty\"};export effect function checked(){const value:Outcome=try Effect.succeed({_tag:\"Found\",value:1});return value}", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, "import * as Effect from \"effect/Effect\";"+tc.body)
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					if tc.code != 0 && d.Code() == tc.code {
						found = true
					} else {
						t.Errorf("unexpected diagnostic: %s", d.String())
					}
				}
			}
			if tc.code != 0 && !found {
				t.Errorf("missing TS%d", tc.code)
			}
		})
	}
}
