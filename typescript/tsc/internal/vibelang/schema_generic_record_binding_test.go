package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaGenericRecordBindings(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		errors       int
	}{
		{"qualified", "schema S=globalThis.Record<\"x\",number>; function f(s:S){s.x=1;const n:number=s.x}", 0},
		{"namespace alias", "namespace N { export import Dictionary=globalThis.Record }; schema S=N.Dictionary<\"x\",number>; function f(s:S){s.x=1;const n:number=s.x}", 0},
		{"local alias", "namespace N { export import Dictionary=globalThis.Record; export function f(){schema S=Dictionary<\"x\",number>; const s:S={x:1};s.x=2;return s} }", 0},
		{"array spelling", "namespace N { export import Array=globalThis.Record }; schema S=N.Array<\"x\",number>; function f(s:S){s.x=1;const n:number=s.x}", 0},
		{"readonly spelling", "namespace N { export import Readonly=globalThis.Record }; schema S=N.Readonly<\"x\",number>; function f(s:S){s.x=1;const n:number=s.x}", 0},
		{"shallow readonly field", "schema S { readonly entries:globalThis.Record<\"x\",number> }; function f(s:S){s.entries.x=1}", 0},
		{"nested", "namespace N { export import Dictionary=globalThis.Record }; schema S { entries:N.Dictionary<\"x\",number[]> }; function f(s:S){s.entries.x.push(1)}", 0},
		{"value only", "const Record=1; schema S=Record<\"x\",number>; function f(s:S){s.x=1}", 0},
		{"custom record", "type Record<K,V>={key:K;value:V}; schema S=Record<string,number>;", 1},
		{"custom renamed type", "namespace N { export type Dictionary<K,V>={key:K;value:V} }; schema S=N.Dictionary<string,number>;", 1},
		{"one argument", "schema S=globalThis.Record<string>;", 1},
		{"three arguments", "schema S=globalThis.Record<string,number,boolean>;", 1},
		{"wrong library arity", "schema S=Array<string,number>;", 1},
		{"own type binding", "schema Record=Record<string,number>;", 1},
		{"optional value key", "const Value=Schema.optionalKey(Schema.Number); schema S=globalThis.Record<\"x\",Value>;", 1},
		{"uncertain value key", "const Optional=Schema.optionalKey(Schema.Number); declare const Value: typeof Schema.Number | typeof Optional; schema S=globalThis.Record<\"x\",Value>;", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export {};\n"+tc.source+"\n")
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == EK2109.Code {
					count++
				} else {
					t.Errorf("unexpected %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
			if count != tc.errors {
				t.Errorf("EK2109 count %d, want %d", count, tc.errors)
			}
		})
	}
}

func TestSchemaGenericRecordLegacyShadowFix(t *testing.T) {
	for _, source := range []string{
		"type Record<K,V>={key:K;value:V}; schema S=Record<string,number>; function f(s:S){s.x=1}",
		"namespace N { export import Record=globalThis.Array; export schema S=Record<string,number>; export function f(s:S){s.x=1} }",
	} {
		fixed := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
		if !strings.Contains(fixed, "Schema.Record") {
			t.Fatalf("old record codec not preserved: %s", fixed)
		}
		program, file, _, _ := editorProgram(t, fixed)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("invalid expansion: %s\n%s", d.String(), fixed)
			}
		}
	}
}

func TestSchemaGenericRecordInverseNames(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		expected     int
	}{
		{"record type shadow", "type Record<K,V>={key:K;value:V}; const Codec=Schema.Struct({xs:Schema.mutableKey(Schema.Record(Schema.String,Schema.mutableKey(Schema.Number)))}); type Codec=typeof Codec.Type", 0},
		{"cross library record name", "namespace N { export import Record=globalThis.Array; const Codec=Schema.Struct({xs:Schema.mutableKey(Schema.Record(Schema.String,Schema.mutableKey(Schema.Number)))}); type Codec=typeof Codec.Type }", 0},
		{"readonly type shadow", "type Readonly<T>={x:T}; const Codec=Schema.Struct({xs:Schema.mutableKey(Schema.Record(Schema.String,Schema.Number))}); type Codec=typeof Codec.Type", 0},
		{"value only shadow", "const Record=1; const Codec=Schema.Struct({xs:Schema.mutableKey(Schema.Record(Schema.String,Schema.mutableKey(Schema.Number)))}); type Codec=typeof Codec.Type", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4832.Code {
					count++
				}
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected error: %s", d.String())
				}
			}
			if count != tc.expected {
				t.Errorf("inverse suggestions %d, want %d", count, tc.expected)
			}
		})
	}
}
