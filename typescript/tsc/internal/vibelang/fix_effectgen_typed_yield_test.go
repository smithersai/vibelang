package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestEffectGenKeepsYieldTypeArguments(t *testing.T) {
	const failure = "interface Unjudged { readonly reason: \"invalid_question\" | \"unconfigured\"; readonly detail: string }\n"
	const payload = "interface Payload { readonly kind: \"ok\" | \"other\" }\n"
	for _, spelling := range []string{"Effect.", ""} {
		for _, tc := range []struct{ name, header, contract, body string }{
			{"fail return", failure, "number!Unjudged", "return yield* " + spelling + "fail<Unjudged>({ reason: \"invalid_question\", detail: \"test\" })"},
			{"fail statement", failure, "number!Unjudged", "yield* " + spelling + "fail<Unjudged>({ reason: \"invalid_question\", detail: \"test\" }); return 1"},
			{"succeed object", payload, "Payload!!", "const value = yield* " + spelling + "succeed<Payload>({ kind: \"ok\" }); const exact: Payload = value; return exact"},
			{"succeed tuple", "", "number!!", "const pair = yield* " + spelling + "succeed<readonly [number, string]>([1, \"x\"]); return pair[0] + pair[1].length"},
			{"succeed callback", "", "number!!", "const fn = yield* " + spelling + "succeed<(n: number) => number>((n) => n + 1); return fn(1)"},
			{"inferred fail control", "", "number!string", "return yield* " + spelling + "fail(\"bad\")"},
			{"inferred succeed control", "", "number!!", "return yield* " + spelling + "succeed(1)"},
		} {
			t.Run(spelling+tc.name, func(t *testing.T) {
				source := tc.header + "export const test = (): " + tc.contract + " => Effect.gen(function*() {\n" + tc.body + "\n})\n"
				_, file, _, _ := editorProgram(t, source)
				dir := filepath.Dir(file.FileName().AsString())
				result := fixCase(t, dir)
				if result.Err != nil || len(result.Refused) != 0 {
					t.Fatalf("fix refused: %+v", result)
				}
				fixed := result.Files[file.FileName()]
				if fixed == nil || strings.Contains(fixed.Text, "Effect.gen") {
					t.Fatalf("generator retained: %+v", fixed)
				}
				program, after, _, _ := editorProgram(t, fixed.Text)
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), after), program.GetSemanticDiagnostics(t.Context(), after)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("fixed source: %s\n%s", d.String(), fixed.Text)
					}
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
				again := fixCase(t, dir)
				if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
					t.Fatalf("not fixed point: %+v", again)
				}
			})
		}
	}
}
