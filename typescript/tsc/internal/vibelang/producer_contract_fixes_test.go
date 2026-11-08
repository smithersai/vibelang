package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

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
