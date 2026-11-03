package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// VIP-6/33 expose the pinned value, while VIP-34 requires a preserving migration
// for the retired runtime helper's optional priority argument.
func TestFixVIPPriorityYield(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"literal", "export effect function main() { try yieldNow(2) }\n"},
		{"optional", "export effect function main(priority?: number) { try yieldNow(priority) }\n"},
		{"argument-once", "function next() { return 2 }\nexport effect function main() { try yieldNow(next()) }\n"},
		{"shadowed-Effect", "const Effect = 1; export effect function main() { try yieldNow(2); return Effect }\n"},
		{"parenthesized", "export effect function main() { try ((yieldNow))(2) }\n"},
		{"comments", "export effect function main() { try yieldNow(/* before */ 2 /* after */,) }\n"},
		{"callee-comments", "export effect function main() { try /* before callee */ (/* inside callee */ yieldNow)(2) }\n"},
		{"multiple", "export effect function main() { try yieldNow(1); try yieldNow(2) }\n"},
		{"untried", "export effect function main() { yieldNow(2) }\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.source)
			dir := filepath.Dir(file.FileName().AsString())
			configFile := filepath.Join(dir, "tsconfig.json")
			if err := os.WriteFile(configFile, []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configFile)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("migration refused: err=%v refused=%+v", result.Err, result.Refused)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, "yieldNowWith") {
				t.Fatalf("missing preserving priority migration: file=%+v refused=%+v", fixed, result.Refused)
			}
			for _, comment := range []string{"/* before callee */", "/* inside callee */", "/* before */", "/* after */"} {
				if strings.Count(tc.source, comment) != strings.Count(fixed.Text, comment) {
					t.Fatalf("comment duplicated or lost: %s\n%s", comment, fixed.Text)
				}
			}
			if tc.name == "argument-once" && strings.Count(fixed.Text, "next()") != 2 {
				t.Fatalf("priority evaluated other than once:\n%s", fixed.Text)
			}
			p, parsed, _, _ := editorProgram(t, fixed.Text)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), parsed) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed source: %s\n%s", diagnosticWithNotes(d), fixed.Text)
				}
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
			if len(again.Files) != 0 {
				t.Fatalf("second run changes priority migration: %+v", again.Files[file.FileName()])
			}
		})
	}
}
