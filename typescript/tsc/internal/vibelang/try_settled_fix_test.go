package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"strings"
	"testing"
)

func TestTrySettledTupleFix(t *testing.T) {
	for _, test := range []struct {
		name, source string
		code         int32
	}{
		{"held", "export effect function f(rows: readonly [Effect.Effect<number>, Effect.Effect<string>]) { return try.allSettled rows }", 2345},
		{"spread", "export effect function f(rows: readonly [Effect.Effect<number>, Effect.Effect<string>]) { return try.allSettled [...rows] }", 2345},
		{"length", "export effect function f(rows: readonly [Effect.Effect<number>, Effect.Effect<number>]) { const results = try.allSettled rows; const n: 2 = results.length; return n }", 2322},
		{"empty-contract", "export effect function f(rows: readonly []): unknown!! { return try.allSettled rows }", 9202},
		{"array", "export effect function f(rows: ReadonlyArray<Effect.Effect<number> | Effect.Effect<string>>): unknown!! { return try.allSettled rows }", 2345},
		{"empty-array", "export effect function f(rows: ReadonlyArray<never>): unknown!! { return try.allSettled rows }", 9202},
		{"literal-union", "export effect function f(rows: ReadonlyArray<Effect.Effect<number> | Effect.Effect<string>>): unknown!! { return try.allSettled [rows[0], rows[1]] }", 2345},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, test.source)
			got := ""
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() != test.code || d.Category() != diagnostics.CategoryError {
					continue
				}
				actions, err := trySettledTupleFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: d.Loc(), ErrorCode: test.code, Program: program, LS: service})
				if err != nil {
					t.Fatal(err)
				}
				if len(actions) != 0 {
					got = applyEditorEdits(t, file, converters, actions[0].Changes)
					break
				}
			}
			if got == "" {
				t.Fatalf("no tuple repair for TS%d", test.code)
			}
			if !strings.Contains(got, "import { $tryAllSettled as $settledTuple }") || !strings.Contains(got, "(try $settledTuple(") {
				t.Fatal(got)
			}
			program, file, _, _ = editorProgram(t, got)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed program: %s\n%s", d.String(), got)
				}
			}
		})
	}
}

func TestTrySettledTupleFixKeepsServiceRequirement(t *testing.T) {
	program, file, service, _ := editorProgram(t, `service Dependency {}
export effect function f(rows: readonly [Effect.Effect<number, never, Dependency>]): number!! {
  const results = try.allSettled rows
  return results.length
}`)
	found := false
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() != EK9202.Code || d.Source() != diagnosticSource {
			continue
		}
		found = true
		actions, err := trySettledTupleFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: d.Loc(), ErrorCode: d.Code(), Program: program, LS: service})
		if err != nil {
			t.Fatal(err)
		}
		if len(actions) != 0 {
			t.Fatal("a real service requirement must not offer the empty-tuple repair")
		}
	}
	if !found {
		t.Fatal("missing service requirement diagnostic")
	}
}

func TestTrySettledArrayFixIgnoresOtherArgumentErrors(t *testing.T) {
	for _, source := range []string{
		`export effect function f(rows: ReadonlyArray<Effect.Effect<number>>) {
  const consume = (value: string) => value
  return consume(try.allSettled rows)
}`,
		`export effect function f(rows: ReadonlyArray<Effect.Effect<number>>) {
  const make = (value: number) => rows
  return try.allSettled make("wrong")
}`,
	} {
		program, file, service, _ := editorProgram(t, source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() != 2345 || d.Category() != diagnostics.CategoryError {
				continue
			}
			found = true
			actions, err := trySettledTupleFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: d.Loc(), ErrorCode: d.Code(), Program: program, LS: service})
			if err != nil {
				t.Fatal(err)
			}
			if len(actions) != 0 {
				t.Fatalf("unrelated argument error must not rewrite allSettled:\n%s", source)
			}
		}
		if !found {
			t.Fatalf("missing argument error:\n%s", source)
		}
	}
}
