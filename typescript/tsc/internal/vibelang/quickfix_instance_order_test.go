package vibelang

import (
	"strings"
	"testing"
)

func TestQuickFixKeepsInstanceTest(t *testing.T) {
	for _, trivia := range []string{"", "// café 😀\n", "/* café 😀 */\n"} {
		for _, crlf := range []bool{false, true} {
			source := trivia + "// @vibelang-diagnostics EK4817:warning\nclass Person extends Schema.Class<Person>(\"Person\")({name:Schema.String}) {}\neffect function readValue() { return new Person({name:\"ok\"}) }\neffect function readType() { return Person }\nexport effect function main() { return (try readValue()) instanceof (try readType()) }\n"
			if crlf {
				source = strings.ReplaceAll(source, "\n", "\r\n")
			}
			t.Run(trivia+source, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, source)
				found := false
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == "EK" && d.Code() == 4817 {
						found = true
						if !strings.Contains(notesOf(d), "No automatic fix") {
							t.Error("refusal needs an explanation")
						}
					}
				}
				if !found {
					t.Fatal("missing diagnostic")
				}
				if got := fileFixes(t.Context(), program, file, nil, []int32{4817}).text(); got != source {
					t.Fatalf("repair changed observable meaning:\n%s", got)
				}
			})
		}
	}
}
