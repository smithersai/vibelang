package vibelang

import (
	"fmt"
	"testing"
)

func TestTryOperationsControlBoundary(t *testing.T) {
	for _, op := range []string{"all", "race", "any", "allSettled"} {
		t.Run(op, func(t *testing.T) {
			source := fmt.Sprintf("control Ask { ask(): number!! } function f() { try { return try.%s [Ask.ask()] } handle Ask.ask() { try resume(1) } }", op)
			program, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4201.Code {
					found = true
				}
			}
			if !found {
				t.Fatal("missing EK4201 at an operation running on another fiber")
			}
		})
	}
}
