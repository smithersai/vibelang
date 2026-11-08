package vibelang

import (
	"testing"
)

func TestOrdinaryAbstractStaticDefault(t *testing.T) {
	p, file, _, _ := editorProgram(t, "abstract class Flags {static readonly default={n:7};abstract n:number}\n")
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4855.Code {
			t.Fatalf("ordinary TypeScript field treated as a service default: %s", d.String())
		}
	}
}
