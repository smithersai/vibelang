package vibelang

import (
	"bytes"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Chapter 7, Legacy entry-dispatch migration: --fix removes only an inert
// marker, and refuses an eligible startup at its marker's line, naming the
// runner to write, because no admitted source keeps main from starting on
// import.
func TestFixLegacyEntryMarker(t *testing.T) {
	cases := []struct{ name, source, want, reason string }{
		{"no main", "import \"vibelang/platform/node\"\nexport const value = 1\n", "export const value = 1\n", ""},
		{"comment kept", "// keep\nimport \"vibelang/platform/bun\";\nexport const value = 1\n", "// keep\nexport const value = 1\n", ""},
		{"two markers", "import \"vibelang/platform/node\"\nimport \"vibelang/platform/bun\"\nexport const value = 1\n", "export const value = 1\n", ""},
		{"default main", "import \"vibelang/platform/node\"\nexport default function main() { return 1 }\n", "export default function main() { return 1 }\n", ""},
		{"runner", "import \"vibelang/platform/node\"\nexport effect function main() { return 1 }\nEffect.runFork(main())\n", "export effect function main() { return 1 }\nEffect.runFork(main())\n", ""},
		{"effect main", "\nimport \"vibelang/platform/node\"\nexport effect function main() { return 1 }\n", "", "@effect/platform-node is not installed, so NodeRuntime.runMain is not available"},
		{"plain main", "import \"vibelang/platform/browser\"\nexport function main(): number { return 1 }\n", "", "@effect/platform-browser is not installed, so BrowserRuntime.runMain is not available"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := result.Files[file.FileName()]
			if tc.reason == "" {
				if fixed == nil || fixed.Text != tc.want || len(result.Refused) != 0 {
					t.Fatalf("want %q; fixed %+v; refused %+v", tc.want, fixed, result.Refused)
				}
				return
			}
			if fixed != nil {
				t.Fatalf("an eligible startup keeps its source, got %q", fixed.Text)
			}
			if len(result.Refused) != 1 || result.Refused[0].Line != strings.Count(tc.source[:strings.Index(tc.source, "import")], "\n")+1 || !strings.Contains(result.Refused[0].Reason, tc.reason) {
				t.Fatalf("want one refusal at the marker naming %q, got %+v", tc.reason, result.Refused)
			}
			var report bytes.Buffer
			result.Report(&report, func(name tspath.RootedFilePath) string { return "main.vibe" })
			line := strings.Split(report.String(), "\n")[0]
			if want := "vibelang --fix: main.vibe:" + strconv.Itoa(result.Refused[0].Line) + ": EK2601 not fixed: "; !strings.HasPrefix(line, want) {
				t.Fatalf("report %q, want prefix %q", line, want)
			}
		})
	}
}

// The reason an eligible startup names the runner and layers the legacy
// compiler selected, as the lowering wrote them.
func TestEntryStartupReasonRunner(t *testing.T) {
	for _, tc := range []struct {
		bundle platformBundle
		want   string
	}{
		{platformBundle{"@effect/platform-node", "NodeRuntime"}, "`import * as NodeRuntime from \"@effect/platform-node/NodeRuntime\"`"},
		{platformBundle{"vibelang-runtime/experimental/platform-node", "ExperimentalNodeServices"}, "`import { ExperimentalNodeServices } from \"vibelang-runtime/experimental/platform-node\"`"},
	} {
		if got := entryImportText(tc.bundle); got != tc.want {
			t.Errorf("entryImportText(%v) = %s, want %s", tc.bundle, got, tc.want)
		}
	}
}
