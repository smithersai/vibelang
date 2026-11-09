package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaGenericTypeBindings(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		count        int
	}{
		{"Array alias", "type Array<T> = { value: T }; schema S = Array<number>", 1},
		{"ReadonlyArray alias", "type ReadonlyArray<T> = { value: T }; schema S = ReadonlyArray<number>", 1},
		{"Record alias", "type Record<K,V> = { key: K; value: V }; schema S = Record<string, number>", 1},
		{"Readonly alias", "type Readonly<T> = { value: T }; schema S = Readonly<Record<string, number>>", 1},
		{"nested Record alias", "type Record<K,V> = { key: K; value: V }; schema S = Readonly<(Record<string, number>)>", 1},
		{"both aliases", "type Record<K,V> = { key: K; value: V }; type Readonly<T> = { value: T }; schema S = Readonly<Record<string, number>>", 2},
		{"interface", "interface Array<T> { value: T }; schema S = Array<number>", 1},
		{"escaped spelling", "type Array<T> = { value: T }; schema S = Arr\\u0061y<number>", 1},
		{"nested struct", "type Record<K,V> = { key: K; value: V }; schema S { field: { nested: Record<string, number> } }", 1},
		{"error field", "type Array<T> = { value: T }; schema error Bad { field: Array<number> }", 1},
		{"namespace", "namespace N { type Record<K,V> = { key: K; value: V }; schema S = Record<string, number> }", 1},
		{"function scope", "function f() { type Array<T> = { value: T }; schema S = Array<number>; return S }", 1},
		{"library types", "schema S { a: Array<number>; b: ReadonlyArray<string>; c: Record<string, number>; d: Readonly<Record<string, number>> }", 0},
		{"value only", "const Array = 1; const ReadonlyArray = 2; const Record = 3; const Readonly = 4; schema S { a: Array<number>; b: ReadonlyArray<string>; c: Record<string, number>; d: Readonly<Record<string, number>> }", 0},
		{"unrelated type", "type Other<T> = T; schema S = Array<number>", 0},
		{"other scope", "namespace N { type Array<T> = { value: T } }; schema S = Array<number>", 0},
		{"ordinary schema value", "const Array = Schema.String; schema S = Array", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export {};\n"+tc.source+"\n")
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == EK2109.Code {
					count++
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
			if count != tc.count {
				t.Errorf("EK2109 count = %d; want %d", count, tc.count)
			}
		})
	}
}

func TestSchemaGenericTypeBindingFormRewrite(t *testing.T) {
	for _, source := range []string{
		"type Array<T> = { value: T }; const S = Schema.mutable(Schema.Array(Schema.Number)); type S = typeof S.Type;",
		"type ReadonlyArray<T> = { value: T }; const S = Schema.Array(Schema.Number); type S = typeof S.Type;",
		"type Record<K,V> = { key: K; value: V }; const S = Schema.Record(Schema.String, Schema.Number); type S = typeof S.Type;",
		"type Readonly<T> = { wrapped: T }; const S = Schema.Record(Schema.String, Schema.Number); type S = typeof S.Type;",
		"type Array<T> = { value: T }; const S = Schema.Struct({ values: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.Number))) }); type S = typeof S.Type;",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export {};\n"+source+"\n")
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4832.Code || d.Code() == EK4841.Code || d.Category() == diagnostics.CategoryError {
					t.Errorf("invalid shorthand offered or source rejected: %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}
