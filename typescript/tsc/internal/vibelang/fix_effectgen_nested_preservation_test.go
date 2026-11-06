package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestEffectGenNestedPipesPreserveChildRepairs(t *testing.T) {
	expression := "Effect.succeed(1).pipe((program: Effect.Effect<number>) => program, Effect.flatMap((n: number) => Effect.succeed(n).pipe(Effect.map((value: number) => value + 1))))"
	for _, held := range []bool{false, true} {
		name, body := "direct", "const value = yield* "+expression+";"
		if held {
			name, body = "held", "const program = "+expression+";\nconst value = yield* program;"
		}
		t.Run(name, func(t *testing.T) {
			source := "export const run = Effect.fn(\"run\")(function* () {\n" + body + "\nreturn value;\n});\n"
			program, file, _, _ := editorProgram(t, source)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			call := firstGeneratorCall(file.AsNode(), c)
			if call == nil {
				done()
				t.Fatal("missing generator")
			}
			rewrite := planEffectGen(c, file, call)
			done()
			if !rewrite.fixable() {
				t.Fatalf("unexpected refusal: %+v", rewrite)
			}
			fixed := applyEdits(file.Text(), rewrite.edits)
			if strings.Contains(fixed, ".pipe(") {
				t.Fatalf("outer capture lost its nested pipeline repair:\n%s", fixed)
			}
			if !strings.Contains(fixed, "return value;") {
				t.Fatalf("outer capture changed the following return:\n%s", fixed)
			}
			checked, fixedFile, _, _ := editorProgram(t, fixed)
			for _, diagnostic := range checked.GetSyntacticDiagnostics(t.Context(), fixedFile) {
				if diagnostic.Category() == diagnostics.CategoryError {
					t.Fatalf("nested rewrite is not valid syntax: %s\n%s", diagnostic.String(), fixed)
				}
			}
		})
	}
}
