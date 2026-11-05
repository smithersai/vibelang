package vibelang

import (
	"path/filepath"
	"strings"
	"testing"
)

// Chapter 7 / VIP-34: refused documentation stays intact when the fixture
// has no independently repairable legacy forms.
func TestVibeThrowsTagFix(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/throws-tag-effectful.fail"), root))
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	if len(result.Files) != 0 {
		for name, file := range result.Files {
			t.Logf("written %s:\n%s", name.AsString(), file.Text)
		}
		t.Fatalf("refused comment repair wrote files: %+v; refusals: %+v", result.Files, result.Sites)
	}
	refused := false
	for _, site := range result.Sites {
		refused = refused || site.Code == "EK0406" && site.StartLine > 0
	}
	if !refused {
		t.Fatalf("missing located documentation refusal: %+v", result.Sites)
	}
}
func TestQuickFixKeepsThrowsComments(t *testing.T) {
	for _, comment := range []string{"/** @throws {never} */", "/** @rethrows f */", "/** Keeps this documentation.\n * @throws {never}\n */"} {
		for _, crlf := range []bool{false, true} {
			source := comment + "\nexport function main(){return 7}\n"
			if crlf {
				source = strings.ReplaceAll(source, "\n", "\r\n")
			}
			t.Run(source, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, source)
				found := false
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Code() == 406 {
						found = true
						if !strings.Contains(notesOf(d), "No automatic fix") {
							t.Error("missing documentation refusal guidance")
						}
					}
				}
				if !found {
					t.Fatal("missing EK0406 witness")
				}
				if got := fileFixes(t.Context(), program, file, nil, []int32{406}).text(); got != source {
					t.Fatalf("repair deleted a comment:\n%s", got)
				}
			})
		}
	}
}
