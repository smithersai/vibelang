package vibelang

import (
	"strings"
	"testing"
)

func TestEffectArrowHeadContextualControls(t *testing.T) {
	for _, source := range []string{
		"const effect = (x: number) => x; const value = effect(1)",
		"function effect<T>(x: T): T { return x }; const value = effect<number>(1)",
		"const effect = 1; const value = effect < 2",
		"const value = (effect: number) => effect",
		"const value: (x: number) => (number!!) = effect x => x",
		"const value = effect (x: number) => x",
		"const value = effect <T>(x: T) => x",
		"const value = effect <T extends (n: number) => number>(x: T) => x",
		"const value = { effect: (x: number) => x }",
		"const effect = 1; effect\nx => x",
		"const value = async x: number => x",
		"const value = effect (x: ) => x",
	} {
		t.Run(strings.ReplaceAll(source, "\n", " newline "), func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Source() == "EK" && d.Code() == 109 {
					t.Fatalf("ordinary/native syntax was reclassified: %s\n%s", d.String(), source)
				}
			}
		})
	}
}

func TestEffectArrowHeadKeepsBodyErrors(t *testing.T) {
	program, file, _, _ := editorProgram(t, "const value = effect x: number => { const broken = }")
	for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
		if d.Source() == "" {
			return
		}
	}
	t.Fatal("the invalid body lost its native parser error")
}
