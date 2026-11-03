package vibelang

import (
	"strings"
	"testing"
)

// VIP-5 explicitly delegates unchecked operands. The plain any-valued
// tail is a separate control: this fix changes only false advice on try.
func TestAnyCallResultIgnoresExplicitTry(t *testing.T) {
	p, file, _, _ := editorProgram(t, `
export effect function direct(make: any) { return try make() }
export const arrow = effect (make: any) => try make()
export effect function optional(make: any) { return try make?.() }
export effect function grouped(make: any) { return try (make()) }
export effect function nested(make: any) { return try effect { return try make() } }
export const object = { effect method(make: any) { return try make() } }
export effect function member(make: any) { return try make.field?.() }
export effect function computed(make: any) { return try make["field"]?.() }
export effect function withDo(make: any) { return try make(do { 1 }) }
export effect function withRun(make: any) { return try make(try Effect.succeed(1)) }
export effect function plain(make: any) { return make() }
`)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4409.Code {
			count++
			if got := diagnosticWithNotes(d); !strings.Contains(got, "so plain succeeds") {
				t.Errorf("explicit try received non-execution advice: %s", got)
			}
		}
	}
	if count != 1 {
		t.Fatalf("got %d EK4409 warnings, want only the plain tail control", count)
	}
}
