package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestResolvedTrySignature(t *testing.T) {
	for _, api := range []string{"try", "tryPromise"} {
		for _, spelling := range []string{"direct", "computed", "callee-parentheses", "receiver-parentheses", "namespace-alias", "function-alias", "comma-callee", "bound"} {
			for _, mode := range []string{"thunk", "options", "catch", "nested"} {
				t.Run(fmt.Sprintf("%s/%s/%s", api, spelling, mode), func(t *testing.T) {
					expression := "risky()"
					if api == "tryPromise" {
						expression = "Promise.resolve(" + expression + ")"
					}
					callback := "()=>" + expression
					want := 0
					if mode == "nested" {
						callback = "()=>{const nested=()=>risky();return "
						if api == "tryPromise" {
							callback += "Promise.resolve(nested())}"
						} else {
							callback += "nested()}"
						}
						want = 1
					}
					if mode == "options" {
						callback = "{try:" + callback + ",catch:(error)=>error}"
					}
					if mode == "catch" {
						callback = "{try:()=>"
						if api == "tryPromise" {
							callback += "Promise.resolve(1)"
						} else {
							callback += "1"
						}
						callback += ",catch:()=>risky()}"
						want = 1
					}
					decl, callee := "", "Effect."+api
					switch spelling {
					case "computed":
						callee = "Effect[\"" + api + "\"]"
					case "callee-parentheses":
						callee = "(" + callee + ")"
					case "receiver-parentheses":
						callee = "(Effect)." + api
					case "namespace-alias":
						decl = "const E=Effect\n"
						callee = "E." + api
					case "function-alias":
						decl = "const bridge=Effect." + api + "\n"
						callee = "bridge"
					case "comma-callee":
						callee = "(0," + callee + ")"
					case "bound":
						decl = "const bridge=Effect." + api + ".bind(undefined)\n"
						callee = "bridge"
					}
					source := "import {Effect} from \"effect\"\nimport {risky} from \"./foreign.js\"\n" + decl + "export const value=" + callee + "(" + callback + ")\n"
					p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": "/** @throws {RangeError} */\nexport declare function risky():number"})
					got := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						got++
						if d.Source() != diagnosticSource || d.Code() != 401 {
							t.Errorf("unexpected: %s", d.String())
						}
					}
					if got != want {
						t.Errorf("got %d errors, want %d EK0401", got, want)
					}
				})
			}
		}
	}
	for _, api := range []string{"sync", "promise"} {
		t.Run(api, func(t *testing.T) {
			expression := "risky()"
			if api == "promise" {
				expression = "Promise.resolve(" + expression + ")"
			}
			src := "import {Effect} from \"effect\"\nimport {risky} from \"./foreign.js\"\nconst bridge=Effect." + api + "\nexport const value=bridge(()=>" + expression + ")"
			p, f, _, _ := requirementIdentityProgram(t, src, map[string]string{"foreign.d.ts": "/** @throws {RangeError} */\nexport declare function risky():number"})
			errors := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					errors++
					if d.Source() != diagnosticSource || d.Code() != 401 {
						t.Errorf("unexpected: %s", d.String())
					}
				}
			}
			if errors != 1 {
				t.Errorf("got %d errors, want one EK0401", errors)
			}
		})
	}
}

func TestResolvedTrySignatureUnrelated(t *testing.T) {
	for _, call := range []string{"E.try(()=>risky())", "E[\"try\"](()=>risky())", "(E.try)(()=>risky())", "E.try.bind(undefined)(()=>risky())"} {
		t.Run(call, func(t *testing.T) {
			source := "import {risky,E} from \"./foreign.js\"\nexport const value=" + call
			library := "/** @throws {RangeError} */\nexport declare function risky():number\nexport declare const E:{try(callback:()=>number):number}"
			p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": library})
			errors := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					errors++
					if d.Source() != diagnosticSource || d.Code() != 401 {
						t.Errorf("unexpected: %s", d.String())
					}
				}
			}
			if errors != 1 {
				t.Errorf("got %d errors, want one EK0401", errors)
			}
		})
	}
}

func TestResolvedTrySignatureUnion(t *testing.T) {
	for _, api := range []string{"try", "tryPromise"} {
		for _, shape := range []string{"strict-first", "admitting-first", "foreign-first", "foreign-last", "all-admitting"} {
			t.Run(api+"/"+shape, func(t *testing.T) {
				allowed := "Effect." + api + "<number>"
				denied := "Effect.sync<number>"
				foreign := "strict"
				expression := "risky()"
				if api == "tryPromise" {
					denied = "Effect.promise<number>"
					foreign = "asyncStrict"
					expression = "Promise.resolve(risky())"
				}
				choice := denied + ":" + allowed
				want := 1
				switch shape {
				case "admitting-first":
					choice = allowed + ":" + denied
				case "foreign-first":
					choice = foreign + ":" + allowed
				case "foreign-last":
					choice = allowed + ":" + foreign
				case "all-admitting":
					choice = "Effect." + api + "<0>:" + allowed
					expression = "risky() as 0"
					if api == "tryPromise" {
						expression = "Promise.resolve(risky() as 0)"
					}
					want = 0
				}
				src := "import {Effect} from \"effect\"\nimport {flag,risky,strict,asyncStrict} from \"./foreign.js\"\nconst bridge=flag?" + choice + "\nexport const value=bridge(()=>" + expression + ")"
				library := `import {Effect} from "effect"
export declare const flag:boolean
/** @throws {RangeError} */
export declare function risky():number
export declare function strict(callback:()=>number):Effect.Effect<number>
export declare function asyncStrict(callback:()=>PromiseLike<number>):Effect.Effect<number>
`
				p, f, _, _ := requirementIdentityProgram(t, src, map[string]string{"foreign.d.ts": library})
				errors := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() == diagnostics.CategoryError {
						errors++
						if d.Source() != diagnosticSource || d.Code() != 401 {
							t.Errorf("unexpected: %s", d.String())
						}
					}
				}
				if errors != want {
					t.Errorf("got %d errors, want %d EK0401", errors, want)
				}
			})
		}
	}
}

func TestResolvedTrySignatureSources(t *testing.T) {
	for _, row := range []struct {
		name, decl, callee, expression string
		want                           int
	}{
		{"namespace", "const bridge=flag?{try:Effect.try<number>}:{try:Effect.sync<number>}", "bridge.try", "risky()", 1},
		{"property", "const bridge={try:flag?Effect.try<number>:Effect.sync<number>}", "bridge.try", "risky()", 1},
		{"shorthand", "const original=flag?Effect.try<number>:Effect.sync<number>;const bridge={original}", "bridge.original", "risky()", 1},
		{"chained", "const original=flag?Effect.try<number>:Effect.sync<number>;const next=original;const bridge=next", "bridge", "risky()", 1},
		{"or", "const bridge=(flag?Effect.try<number>:undefined)||Effect.sync<number>", "bridge", "risky()", 1},
		{"coalesce", "const bridge=(flag?Effect.try<number>:undefined)??Effect.sync<number>", "bridge", "risky()", 1},
		{"all-admitting-property", "const bridge=flag?{try:Effect.try<0>}:{try:Effect.try<number>}", "bridge.try", "risky() as 0", 0},
		{"annotated", "const bridge:typeof Effect.try=Effect.try", "bridge", "risky()", 0},
		{"destructure", "const {try:bridge}=Effect", "bridge", "risky()", 0},
		{"mutable", "let bridge=flag?Effect.try<number>:Effect.sync<number>", "bridge", "risky()", 1},
		{"returned", "const make=()=>flag?Effect.try<number>:Effect.sync<number>;const bridge=make()", "bridge", "risky()", 1},
	} {
		t.Run(row.name, func(t *testing.T) {
			src := "import {Effect} from \"effect\"\nimport {flag,risky} from \"./foreign.js\"\n" + row.decl + "\nexport const value=" + row.callee + "(()=>" + row.expression + ")"
			p, f, _, _ := requirementIdentityProgram(t, src, map[string]string{"foreign.d.ts": "export declare const flag:boolean\n/** @throws {RangeError} */\nexport declare function risky():number"})
			errors := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					errors++
					if d.Source() != diagnosticSource || d.Code() != 401 {
						t.Errorf("unexpected: %s", d.String())
					}
				}
			}
			if errors != row.want {
				t.Errorf("got %d errors, want %d EK0401", errors, row.want)
			}
		})
	}
}
