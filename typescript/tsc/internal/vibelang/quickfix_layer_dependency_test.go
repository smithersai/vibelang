package vibelang

import (
	"strings"
	"testing"
)

func TestQuickFixKeepsLayerDependency(t *testing.T) {
	for _, trivia := range []string{"", "// café 😀\n", "/* café 😀 */\n"} {
		for _, crlf := range []bool{false, true} {
			source := trivia + "service Input { readonly value: number }\nservice Output { readonly value: number }\nconst InputLive = Layer.succeed(Input, {value: 1})\nconst OutputLive = Layer.effect(Output, effect { return {value: (try Input).value} })\nexport const App = Layer.mergeAll(InputLive, OutputLive)\nexport effect function main() { provide Layer.succeed(Input, {value: 2}) { provide App { return (try Output).value } } }\n"
			if crlf {
				source = strings.ReplaceAll(source, "\n", "\r\n")
			}
			t.Run(trivia+source, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, source)
				found := false
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == "EK" && d.Code() == 4807 {
						found = true
						if !strings.Contains(notesOf(d), "No automatic fix") {
							t.Error("refusal needs an explanation")
						}
					}
				}
				if !found {
					t.Fatal("missing diagnostic")
				}
				if got := fileFixes(t.Context(), program, file, nil, []int32{4807}).text(); got != source {
					t.Fatalf("repair changed observable meaning:\n%s", got)
				}
			})
		}
	}
}
