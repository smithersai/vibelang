package vibelang

import (
	"fmt"
	"testing"
)

// VIP-1 and VIP-5: placement is independent of the operand type.
func TestEffectAwaitPlacementCode(t *testing.T) {
	operands := []struct{ name, prelude, value string }{
		{"promise", "", "Promise.resolve(1)"},
		{"thenable", "declare const value: PromiseLike<number>;", "value"},
		{"scalar", "", "1"},
		{"any", "declare const value: any;", "value"},
		{"unknown", "declare const value: unknown;", "value"},
		{"never", "declare const value: never;", "value"},
		{"effect", "", "Effect.succeed(1)"},
		{"fiber", "declare const value: Fiber.Fiber<number>;", "value"},
		{"deferred", "declare const value: Deferred.Deferred<number>;", "value"},
		{"union", "declare const value: number | Promise<number>;", "value"},
		{"parentheses", "", "((Promise.resolve(1)))"},
		{"comment", "", "/* wait 😀 */ Promise.resolve(1)"},
	}
	contexts := []struct{ name, body string }{
		{"function", "effect function f() { %s; return 0 }"},
		{"arrow", "const f = effect () => { %s; return 0 }"},
		{"block", "const f = effect { %s; return 0 }"},
		{"producer", "effect function* f() { %s; yield 0 }"},
	}
	for _, operand := range operands {
		for _, context := range contexts {
			t.Run(operand.name+"/"+context.name, func(t *testing.T) {
				source := "import { Effect, Fiber, Deferred } from \"effect\";\n" + operand.prelude + "\n" + fmt.Sprintf(context.body, "await "+operand.value)
				program, file, _, _ := editorProgram(t, source)
				all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
				placement := 0
				for _, d := range all {
					if d.Source() != diagnosticSource {
						continue
					}
					if d.Code() == EK0102.Code {
						placement++
					}
					if d.Code() == 4601 || d.Code() == 4602 || d.Code() == 4603 || d.Code() == 4604 {
						t.Errorf("legacy await diagnostic: %s", d.String())
					}
				}
				if placement != 1 {
					t.Errorf("want exactly one EK0102; got %d in %s", placement, source)
				}
			})
		}
	}
}

func TestNativeAsyncAwaitKeepsPlacement(t *testing.T) {
	for _, operand := range []string{"Promise.resolve(1)", "1", "(undefined as unknown)", "(undefined as any)"} {
		t.Run(operand, func(t *testing.T) {
			source := "export async function f() { return await " + operand + " }"
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Source() == diagnosticSource && d.Code() == EK0102.Code {
					t.Errorf("native async await got EK0102: %s", d.String())
				}
			}
		})
	}
}
