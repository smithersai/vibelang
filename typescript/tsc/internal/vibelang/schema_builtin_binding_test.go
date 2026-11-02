package vibelang

import (
	"os"
	"path/filepath"
	"strings"
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

func TestSchemaGenericTypeBindingQuickFix(t *testing.T) {
	for _, source := range []string{
		"type Array<T> = { value: T }; schema S = Array<number>",
		"type Readonly<T> = { value: T }; schema S { values: Readonly<Record<string, number>> }",
		"type Record<K,V> = { key: K; value: V }; schema S = Readonly<Record<string, number>>",
		"type Array<T> = { value: T }; schema error Bad { values: Array<number> }",
		"namespace N { type Array<T> = { value: T }; export schema S = Array<number> }",
	} {
		t.Run(source, func(t *testing.T) {
			fixed := applyQuickFixOf(t, "export {};\n"+source+"\n", EK2109.Code, diagnostics.CategoryError)
			if !strings.Contains(fixed, "Schema") {
				t.Fatalf("missing explicit codec: %s", fixed)
			}
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source reports %s%d: %s\n%s", d.Source(), d.Code(), d.String(), fixed)
				}
			}
		})
	}
}

func TestFixProjectSchemaGenericTypeBinding(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(root, "typescript/vibelang/cases/schema-generic-type-shadow-upgrade")
	before, err := os.ReadFile(filepath.Join(fixture, "main.before.vibe.txt"))
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, fixture, root)
	main := filepath.Join(dir, "main.vibe")
	if err := os.WriteFile(main, before, 0600); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	if len(result.Files) != 1 || len(result.Refused) != 0 {
		t.Fatalf("fixed %d files, refused %+v", len(result.Files), result.Refused)
	}
	for _, fixed := range result.Files {
		if err := os.WriteFile(main, []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if again := fixCase(t, dir); len(again.Files) != 0 {
		t.Fatalf("second --fix changes %v", again.Order)
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
