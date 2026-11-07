package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// retiredDiagnosticSites lists each EK diagnostic in source as line:column code, 1-based.
func retiredDiagnosticSites(t *testing.T, source string) []string {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	var sites []string
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Source() != diagnosticSource {
			continue
		}
		before := source[:d.Pos()]
		line := strings.Count(before, "\n") + 1
		column := d.Pos() - strings.LastIndex(before, "\n")
		sites = append(sites, fmt.Sprintf("%d:%d EK%04d", line, column, d.Code()))
	}
	return sites
}

// rule-evidence: docs/design/src/000-intro.md#retired-continuation-forms | The first-release retirement diagnostics are `EK3501` for `control` and `handle` syntax or resolved continuation-runtime `Control`, `resume`, `resumeWith`, `abandon` and `handle`, and `EK4607` for a retired `select` block.
func TestRetiredContinuationDiagnosticSites(t *testing.T) {
	for _, test := range []struct {
		name, source string
		want         []string
	}{
		{"control and handle syntax", "control Ask { ask(x: number): number!! }\nexport effect function main(): number!! {\n  try { return try Ask.ask(4) } handle Ask.ask(x) { return try resume(x + 2) }\n}\n",
			[]string{"1:1 EK3501", "3:33 EK3501"}},
		{"runtime exports", "import { Control, resume, resumeWith, abandon, handle } from \"vibelang-runtime\"\nexport const control = Control\nexport const resumed = resume\nexport const resumedWith = resumeWith\nexport const abandoned = abandon\nexport const handled = handle\n",
			[]string{"1:10 EK3501", "1:19 EK3501", "1:27 EK3501", "1:39 EK3501", "1:48 EK3501", "2:24 EK3501", "3:24 EK3501", "4:28 EK3501", "5:26 EK3501", "6:24 EK3501"}},
		// Ordinary bindings and members with the same names keep their native meaning.
		{"native names", "function local(resume: number, handle: string) { return { resume, handle, abandon: 1, resumeWith: 2, Control: 3 } }\nexport const plain = local(1, \"x\").abandon\n", nil},
		{"select", "export effect function main() { select { default: return 1 } }\n", []string{"1:33 EK4607"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := retiredDiagnosticSites(t, test.source); !slices.Equal(got, test.want) {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}
