package vibelang

import (
	"strings"
	"testing"
)

func TestAnyCallResultIgnoresErrorRecovery(t *testing.T) {
	p, file, _, _ := editorProgram(t, `import * as Effect from "effect/Effect"
export function missingMember(value: { present: number }) {
  Effect.yieldNow()
  return value.missing()
}
export function missingName() {
  Effect.yieldNow()
  return notDeclared()
}
export function genuineAny(value: any) {
  Effect.yieldNow()
  return value()
}`)
	count := 0
	missingMember, missingName := false, false
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		switch d.Code() {
		case EK4409.Code:
			count++
			if got := diagnosticWithNotes(d); !strings.Contains(got, "genuineAny") {
				t.Errorf("unexpected any-call warning: %s", got)
			}
		case 2339:
			missingMember = true
		case 2304:
			missingName = true
		}
	}
	if count != 1 || !missingMember || !missingName {
		t.Fatalf("got %d EK4409 warnings, missing member=%v, missing name=%v", count, missingMember, missingName)
	}
}
