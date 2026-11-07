package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestPlainInferWrappedCallbackRepair(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"generator", "export const make = Effect.gen(function* () { const run = effect () => try Effect.tryPromise({ try: (): infer _ => Promise.resolve(1), catch: (cause): infer _ => String(cause) }); return { run }; });"},
		{"block", "export const make = effect { const run = effect () => try Effect.tryPromise({ try: (): infer _ => Promise.resolve(1), catch: (cause): infer _ => String(cause) }); return { run }; };"},
		{"direct promise", "export const make = Effect.tryPromise((): infer _ => Promise.resolve(1));"},
		{"direct try", "export const make = Effect.try((): infer _ => 1);"},
		{"parameter comment", "export const make = Effect.try((value?: number /* ) */): infer _ => value ?? 1);"},
		{"newline", "export const make = Effect.try(()\n: infer _ => 1);"},
		{"sync", "export const make = sync((): infer _ => 1);"},
		{"callback", "export const make = callback<number>((resume): infer _ => { resume(Effect.succeed(1)); });"},
		{"native callback", "export const make = Effect.callback<number>((resume): infer _ => { resume(Effect.succeed(1)); });"},
		{"nested function", "export const make = sync(() => { function read(): infer _ { return 1 }; return read(); });"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result, name := fixSourceOptions(t, tc.source+"\n", FixOptions{})
			fixed := result.Files[name]
			if fixed == nil {
				t.Fatalf("legacy callback annotation was not repaired: err=%v refused=%+v fixed=%+v", result.Err, result.Refused, fixed)
			}
			program, file, _, _ := editorProgram(t, fixed.Text)
			for _, diagnostic := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if diagnostic.Category() == diagnostics.CategoryError {
					t.Errorf("fixed callback: %s\n%s", diagnostic.String(), fixed.Text)
				}
			}
		})
	}
}

func TestPlainInferWrappedCallbackBoundaries(t *testing.T) {
	for _, source := range []string{
		"export const make = Effect.tryPromise(async (): infer _ => 1);",
		"export const make = Effect.try(function* (): infer _ { yield 1 });",
		"export const make = Effect.try((): infer Result => 1);",
		"export const make = Effect.try((): infer _ extends number => 1);",
		"export const make = Effect.try((): /* retain */ infer _ => 1);",
		"export const make = Effect.try((): number extends infer _ ? _ : never => 1);",
	} {
		result, name := fixSourceOptions(t, source+"\n", FixOptions{})
		if fixed := result.Files[name]; fixed != nil && (!strings.Contains(fixed.Text, "infer")) {
			t.Fatalf("unsupported native annotation changed: %s\n%+v", fixed.Text, result.Refused)
		}
	}
}
