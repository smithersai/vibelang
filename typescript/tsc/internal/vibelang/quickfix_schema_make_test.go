package vibelang

import (
	"strings"
	"testing"
)

func TestQuickFixKeepsSchemaMake(t *testing.T) {
	for _, trivia := range []string{"", "// café 😀\n", "/* café 😀 */\n"} {
		for _, crlf := range []bool{false, true} {
			source := trivia + "// @vibelang-diagnostics EK4821:warning\nexport const Opened=Schema.Struct({_tag:Schema.Literal(\"Opened\"),at:Schema.Number})\n"
			if crlf {
				source = strings.ReplaceAll(source, "\n", "\r\n")
			}
			t.Run(trivia+source, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, source)
				found := false
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == "EK" && d.Code() == 4821 {
						found = true
						if !strings.Contains(notesOf(d), "No automatic fix") {
							t.Error("refusal needs an explanation")
						}
					}
				}
				if !found {
					t.Fatal("missing diagnostic")
				}
				if got := fileFixes(t.Context(), program, file, nil, []int32{4821}).text(); got != source {
					t.Fatalf("repair changed observable meaning:\n%s", got)
				}
			})
		}
	}
}
