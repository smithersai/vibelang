package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Public annotations can keep declaration bytes equal even when a rewrite
// introduces a type error. An unrelated existing error must remain allowed.
func TestRelicDeclarationGuardDiagnostics(t *testing.T) {
	for _, tc := range []struct {
		name, before, after string
		refuse              bool
	}{
		{"new error", "export const value: number = 1;", "export const value: number = \"bad\";", true},
		{"existing error", "export const bad: number = \"bad\"; export const value: number = 1;", "export const bad: number = \"bad\"; export const value: number = 2;", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.before)
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(file.FileName().Directory().ResolveFile("tsconfig.json"), &core.CompilerOptions{}, nil, fs, nil)
			if config == nil || len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			build := func(texts map[tspath.RootedFilePath]string) *compiler.Program {
				return fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, texts)
			}
			declarations := relicDeclarationBytes(t.Context(), program)
			found := false
			for _, text := range declarations {
				found = found || strings.Contains(text, "value: number")
			}
			if !found {
				t.Fatalf("expected a nonempty public API: %v", declarations)
			}
			proposed := proposal{file: file, fixes: []fileFix{{key: "relic-guard-test", label: "guard test", edits: []sourceEdit{{0, len(file.Text()), tc.after}}}}}
			var refused []FixRefusal
			result := preserveRelicDeclarations(t.Context(), program, nil, proposed, build, func(r FixRefusal, key string) {
				if key != "relic-guard-test" {
					t.Fatalf("wrong refusal key: %s", key)
				}
				refused = append(refused, r)
			})
			if tc.refuse {
				if len(result.fixes) != 0 || len(refused) != 1 || !strings.Contains(refused[0].Error, "TS2322") {
					t.Fatalf("ill-typed candidate with the same declared API accepted: fixes=%v refused=%+v", result.fixes, refused)
				}
			} else if len(result.fixes) != 1 || len(refused) != 0 {
				t.Fatalf("existing type error prevented a safe same-API change: fixes=%v refused=%+v", result.fixes, refused)
			}
		})
	}
}
