package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-5 applies to async generators regardless of their written iterator type.
func TestAsyncGeneratorAwaitEffect(t *testing.T) {
	for _, annotation := range []string{"", ": AsyncGenerator<number, void, unknown>", ": AsyncIterator<number>", ": AsyncIterableIterator<number>", ": AsyncIterable<number>", ": (AsyncGenerator<number, void, unknown>)", ": Output"} {
		for _, form := range []string{"export async function* values()%s { %s; yield 2 }", "export const values=async function* ()%s { %s; yield 2 }", "export class Feed { async *values()%s { %s; yield 2 } }", "export const feed={async *values()%s { %s; yield 2 }}"} {
			t.Run(annotation+form, func(t *testing.T) {
				source := "import {Effect} from \"effect\"; type Output=AsyncGenerator<number,void,unknown>; " + fmt.Sprintf(form, annotation, "await Effect.succeed(1)")
				program, file, _, _ := editorProgram(t, source)
				found := 0
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == diagnosticSource && d.Code() == EK0103.Code {
						found++
					} else if d.Category() == diagnostics.CategoryError {
						t.Errorf("unexpected: %s", d.String())
					}
				}
				if found != 1 {
					t.Fatalf("expected one EK0103, got %d\n%s", found, source)
				}
			})
		}
	}
}

func TestAsyncGeneratorAwaitValueControls(t *testing.T) {
	for _, statement := range []string{"await Promise.resolve(1)", "await Effect.runPromise(Effect.succeed(1))", "for await(const value of [1,2]) { void value }", "await 1", "await (undefined as unknown)", "await (undefined as any)"} {
		t.Run(statement, func(t *testing.T) {
			source := "import {Effect} from \"effect\"; export async function* values(): AsyncGenerator<number,void,unknown> { " + statement + "; yield 2 }"
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("%s\n%s", d.String(), source)
				}
			}
		})
	}
}
