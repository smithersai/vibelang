package vibelang

import (
	"os"
	"strings"
	"testing"
)

// Chapter 007 / obsolete main advisory retires: docs/design/src/007-tooling.md#b92700b6c0f76fd9
// Chapter 007 / entry binding initialization is preserved: docs/design/src/007-tooling.md#617d932df701937d
func TestChapter007OrdinaryMainAdvisory(t *testing.T) {
	if os.Getenv("VIBELANG_COVERAGE_RUN_PENDING") != "1" {
		t.Skip("docs/design/src/007-tooling.md#b92700b6c0f76fd9 and #617d932df701937d: obsolete EK4843 offers to hoist an ordinary lexical main binding")
	}
	source := "let seen: unknown\nfunction read(): unknown { return main }\ntry { seen = typeof read() } catch (e) { seen = e instanceof Error ? e.name : String(e) }\nexport const main = (): number => 7\nexport function probe(): unknown { return seen }\n"
	p, f, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
		if d.Code() == EK4843.Code {
			fixed := applyQuickFix(t, source, EK4843.Code)
			if !strings.Contains(fixed, "export const main") {
				t.Errorf("ordinary entry binding was rewritten, changing TDZ:\n%s", fixed)
			}
			t.Errorf("obsolete entry advisory remains: %s", d.String())
		}
	}
}
