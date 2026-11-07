package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// TypeScript parses @exception and @throws as the same JSDocThrowsTag.
// Both describe foreign thrown contracts and are forbidden on VibeLang source.
func TestExceptionTagAlias(t *testing.T) {
	for _, tag := range []string{"@exception {RangeError}", "@exception {never}", "@exception", "@exception A failure when parsing."} {
		for _, shape := range []struct{ name, source string }{
			{"function", "DOC\nexport function read() { return 1 }"},
			{"arrow", "DOC\nexport const read = () => 1"},
			{"effect", "DOC\nexport effect function read() { return 1 }"},
			{"async", "DOC\nexport async function read() { return 1 }"},
			{"method", "export class Reader {\nDOC\nread() { return 1 }\n}"},
			{"call-signature", "export type Reader = {\nDOC\n(): number\n}"},
		} {
			for _, crlf := range []bool{false, true} {
				name := shape.name + "/" + tag
				if crlf {
					name += "/crlf"
				}
				t.Run(name, func(t *testing.T) {
					source := strings.Replace(shape.source, "DOC", "/** "+tag+" */", 1)
					if crlf {
						source = strings.ReplaceAll(source, "\n", "\r\n")
					}
					program, file, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						count++
						if d.Code() != 406 || d.Source() != diagnosticSource {
							t.Errorf("unexpected diagnostic: %s", d.String())
						}
						if !strings.Contains(d.String(), "@exception") || !strings.Contains(notesOf(d), "No automatic fix") {
							t.Errorf("missing tag/refusal guidance: %s", d.String())
						}
					}
					if count != 1 {
						t.Fatalf("got %d errors, want one EK0406", count)
					}
					if got := fileFixes(t.Context(), program, file, nil, []int32{406}).text(); got != source {
						t.Fatalf("automatic repair changed authored documentation: %s", got)
					}
				})
			}
		}
	}
}
