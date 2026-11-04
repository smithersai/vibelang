package vibelang

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestProducerWrittenContractFix(t *testing.T) {
	for _, test := range []struct{ name, source, body string }{
		{"declaration", "export effect function* values(): number[] { /* keep 😀 */ yield 7 }", "{ /* keep 😀 */ yield 7 }"},
		{"object-error", "export const holder = { effect *values(): Stream.Stream<number> { yield 7; throw \"bad\" } }", "{ yield 7; throw \"bad\" }"},
		{"class-error", "export class Holder { effect *values(): Stream.Stream<number> { yield 7; throw \"bad\" } }", "{ yield 7; throw \"bad\" }"},
		{"object-property", "export const holder = { effect *values(): Stream.Stream<number> & {extra:number} { yield 7 } }", "{ yield 7 }"},
		{"class-property", "export class Holder { effect *values(): Stream.Stream<number> & {extra:number} { yield 7 } }", "{ yield 7 }"},
		{"declaration-property", "export effect function* values(): Stream.Stream<number> & {extra:number} { yield 7 }", "{ yield 7 }"},
		{"object-readonly-property", "export const holder = { effect *values(): Stream.Stream<number> & {readonly extra:string} { yield 7 } }", "{ yield 7 }"},
		{"class-union", "export class Holder { effect *values(): Stream.Stream<string> | undefined { yield 7 } }", "{ yield 7 }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, test.source)
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			fixed := result.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, test.body) {
				t.Fatalf("missing preserving rewrite: %+v", fixed)
			}
			program, edited, _, _ := editorProgram(t, fixed.Text)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), edited) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("rewritten source: %s\n%s", d.String(), fixed.Text)
				}
			}
			again := fixCase(t, filepath.Dir(edited.FileName().AsString()))
			if after := again.Files[edited.FileName()]; after != nil && after.Text != fixed.Text {
				t.Fatalf("rewrite is not idempotent:\n%s", after.Text)
			}
		})
	}
}

func TestProducerContractFixKeepsUnrelatedMismatch(t *testing.T) {
	for _, test := range []struct {
		source string
		code   int32
	}{
		{"export class Holder { effect *values(): Generator<number, void, unknown> { yield 7 } }", EK2102.Code},
		{"export class Holder { effect *values(): Stream.Stream<number> { const wrong: string = 1; yield 7 } }", 2322},
		{"export class Holder { effect *values(): Stream.Stream<number> { effect function inner(): number!! { throw \"bad\" }; yield 7 } }", EK9201.Code},
	} {
		program, file, _, _ := editorProgram(t, test.source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() != test.code {
				continue
			}
			found = true
			actions, err := producerContractFixActions(t.Context(), &ls.CodeFixContext{
				SourceFile: file, Span: core.NewTextRange(d.Pos(), d.End()), ErrorCode: d.Code(), Program: program,
			})
			if err != nil || len(actions) != 0 {
				t.Fatalf("offered contract rewrite for unrelated error: %v, %v", actions, err)
			}
		}
		if !found {
			t.Fatalf("missing diagnostic %d in %s", test.code, test.source)
		}
	}
}

// Enabling the producer's specific TS2322 action must not opt unrelated
// assignment or return mismatches into project-wide automatic repair.
func TestProducerContractCLIKeepsUnrelatedAssignments(t *testing.T) {
	for _, source := range []string{
		"export const value: number = 'wrong';",
		"export function value(): number { return 'wrong' }",
		"export effect function* values(): Stream.Stream<number> { const wrong: string = 1; yield 7 }",
	} {
		_, file, _, _ := editorProgram(t, source)
		result := fixCase(t, filepath.Dir(file.FileName().AsString()))
		if result.Err != nil || len(result.Files) != 0 {
			t.Fatalf("unrelated mismatch changed: %+v", result)
		}
	}
}
