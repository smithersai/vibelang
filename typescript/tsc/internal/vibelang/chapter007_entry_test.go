package vibelang

import (
	"strings"
	"testing"
)

// Chapter 007 / obsolete main advisory retires: docs/design/src/007-tooling.md#b92700b6c0f76fd9
// Chapter 007 / entry binding initialization is preserved: docs/design/src/007-tooling.md#617d932df701937d
func TestChapter007OrdinaryMainAdvisory(t *testing.T) {
	source := "let seen: unknown\nfunction read(): unknown { return main }\ntry { seen = typeof read() } catch (e) { seen = e instanceof Error ? e.name : String(e) }\nexport const main = (): number => 7\nexport function probe(): unknown { return seen }\n"
	p, f, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
		if d.Source() == diagnosticSource && d.Code() == 4843 {
			t.Errorf("obsolete entry advisory remains: %s", d.String())
		}
	}
	for _, mode := range []struct {
		name    string
		options FixOptions
	}{
		{"ordinary", FixOptions{}},
		{"vip", FixOptions{VIPOnly: true}},
		{"migration", FixOptions{MigrationOnly: true}},
	} {
		t.Run(mode.name, func(t *testing.T) {
			result, name := fixSourceOptions(t, source, mode.options)
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := source
			if file := result.Files[name]; file != nil {
				fixed = file.Text
			}
			if !strings.Contains(fixed, "export const main") || strings.Contains(fixed, "export function main") {
				t.Errorf("ordinary entry binding was rewritten, changing TDZ:\n%s", fixed)
			}
		})
	}
}
