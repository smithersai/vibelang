package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Detail 87: Number passed as a constructor parameter can return a number,
// so the public helper result cannot promise an object.
func TestConstructorParameterExtractionTypes(t *testing.T) {
	for _, name := range []string{"String", "Number", "Boolean", "BigInt", "Symbol"} {
		t.Run(name, func(t *testing.T) {
			source := fmt.Sprintf("import {$extract} from \"vibelang-runtime\"; function f(C: %sConstructor, s: unknown): object | undefined { const extracted=$extract(C,s);return extracted===false?undefined:extracted[0] }", name)
			program, file, _, _ := editorProgram(t, source)
			ds := program.GetSemanticDiagnostics(t.Context(), file)
			if len(ds) != 1 || ds[0].Code() != 2322 {
				t.Fatalf("want TS2322 for a possible primitive, got %v", ds)
			}
		})
	}
	for _, source := range []string{
		"import {$extract} from \"vibelang-runtime\"; function f(C: new () => Number, s:unknown):object|undefined {const extracted=$extract(C,s);return extracted===false?undefined:extracted[0]}",
		"import {$extract} from \"vibelang-runtime\"; function f<T extends NumberConstructor>(C:T,s:unknown):object|undefined{const extracted=$extract(C,s);return extracted===false?undefined:extracted[0]}",
		"import {$extract} from \"vibelang-runtime\"; function f(C=Number,s:unknown):object|undefined{const extracted=$extract(C,s);return extracted===false?undefined:extracted[0]}",
	} {
		program, file, _, _ := editorProgram(t, source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			found = found || d.Code() == 2322
		}
		if !found {
			t.Errorf("missing TS2322 in %s", source)
		}
	}
}

func TestConstructorExtractionKeepsKnownValues(t *testing.T) {
	for _, source := range []string{
		"import {$extract} from \"vibelang-runtime\"; function f(C:NumberConstructor,s:unknown):number|Number|undefined{const extracted=$extract(C,s);return extracted===false?undefined:extracted[0]}",
		"import {$extract} from \"vibelang-runtime\"; function f(C:SymbolConstructor,s:unknown):symbol|Symbol|undefined{const extracted=$extract(C,s);return extracted===false?undefined:extracted[0]}",
		"import {$extract} from \"vibelang-runtime\"; class N extends Number{declare readonly marker:\"brand\"};function f(s:unknown):N|undefined{const extracted=$extract(N,s);return extracted===false?undefined:extracted[0]}",
		"import {$extract} from \"vibelang-runtime\"; declare class N extends Number{readonly marker: \"brand\"};function f(s:unknown):object|undefined{const extracted=$extract(N,s);return extracted===false?undefined:extracted[0]}",
		"import {$extract} from \"vibelang-runtime\"; class N<T> extends Number{declare value:T};function f(s:unknown):N<unknown>|undefined{const extracted=$extract(N,s);return extracted===false?undefined:extracted[0]}",
		"import {$extract} from \"vibelang-runtime\"; const P=new Proxy(Number,{});function f(s:unknown):number|Number|undefined{const extracted=$extract(P,s);return extracted===false?undefined:extracted[0]}",
		"import {$extract} from \"vibelang-runtime\"; const P=new Proxy(Number,{});const Alias=P;function f(s:unknown):number|Number|undefined{const extracted=$extract(Alias,s);return extracted===false?undefined:extracted[0]}",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%s: %s", source, d.String())
			}
		}
	}
}

// A declaration file or ambient declaration can describe Number itself.
func TestConstructorAmbientClassMayBePrimitive(t *testing.T) {
	for _, source := range []string{
		"import {$extract} from \"vibelang-runtime\"; declare class N extends Number {}; function f(s:unknown):object|undefined{const extracted=$extract(N,s);return extracted===false?undefined:extracted[0]}",
		"import {$extract} from \"vibelang-runtime\"; declare namespace Library {class N extends Number {}}; function f(s:unknown):object|undefined{const extracted=$extract(Library.N,s);return extracted===false?undefined:extracted[0]}",
		"import {$extract} from \"vibelang-runtime\"; declare class N extends Number {}; const Alias=N; function f(s:unknown):object|undefined{const extracted=$extract(Alias,s);return extracted===false?undefined:extracted[0]}",
	} {
		program, file, _, _ := editorProgram(t, source)
		ds := program.GetSemanticDiagnostics(t.Context(), file)
		if len(ds) != 1 || ds[0].Code() != 2322 {
			t.Errorf("want only TS2322 for a possible primitive, got %v in %s", ds, source)
		}
	}
}
