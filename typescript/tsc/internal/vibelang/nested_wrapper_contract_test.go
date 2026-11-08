package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestNestedWrapperContract(t *testing.T) {
	for _, wrapper := range []string{"Effect.sync", "Effect.promise", "capture"} {
		for _, shape := range []struct {
			name, expr string
			effectful  bool
		}{
			{"effect-function", "effect function nested() { return foreign() }", true},
			{"effect-arrow", "effect () => foreign()", true},
			{"effect-block", "effect { return foreign() }", true},
			{"direct-function", "effect function nested() { return foreign() }", true},
			{"direct-arrow", "effect () => foreign()", true},
			{"effect-default", "effect function nested(value = foreign()) { return value }", false},
			{"nested-wrapper", "effect function nested() { return try Effect.try(() => foreign()) }", false},
			{"plain-function", "function nested() { return foreign() }", false},
			{"transparent-do", "do { foreign() }", false},
		} {
			if wrapper == "Effect.promise" && strings.HasPrefix(shape.name, "direct-") {
				continue
			}
			for _, contract := range []string{"untagged", "RangeError", "never"} {
				t.Run(fmt.Sprintf("%s/%s/%s", wrapper, shape.name, contract), func(t *testing.T) {
					annotation := ""
					if contract != "untagged" {
						annotation = "/** @throws {" + contract + "} */\n"
					}
					lib := annotation + "export function foreign(): number { return 1 }\n"
					expr := shape.expr
					if wrapper == "Effect.promise" {
						expr = "Promise.resolve(" + expr + ")"
					}
					argument := "() => { return " + expr + " }"
					if strings.HasPrefix(shape.name, "direct-") {
						argument = expr
					}
					source := "import {foreign} from \"./foreign.js\"\nimport {sync as capture} from \"effect/Effect\"\nexport const probe = " + wrapper + "(" + argument + ")\n"
					p, f, _, _ := editorProgramAt(t, "main.vibe", `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true}`, source, editorPackageJSON, editorPackages)
					if err := os.WriteFile(filepath.Join(filepath.Dir(f.FileName().AsString()), "foreign.ts"), []byte(lib), 0600); err != nil {
						t.Fatal(err)
					}
					p = compiler.NewProgram(compiler.ProgramOptions{Config: p.CommandLine(), Host: p.Host()})
					f = p.GetSourceFile(f.FileName())
					want := int32(0)
					if shape.effectful && contract != "never" {
						want = 403
					}
					if shape.name == "effect-default" && contract != "never" || shape.name == "plain-function" && contract == "RangeError" {
						want = 401
					}
					// The directly wrapped do expression shares the wrapper activation.
					if shape.name == "transparent-do" && contract == "RangeError" {
						want = 401
					}
					count := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						count++
						if want == 0 || d.Source() != diagnosticSource || d.Code() != want {
							t.Errorf("unexpected: %s", d.String())
						}
					}
					n := 0
					if want != 0 {
						n = 1
					}
					if count != n {
						t.Errorf("got %d errors, want %d (EK%04d)", count, n, want)
					}
				})
			}
		}
	}
}
