package vibelang

import (
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// A syntax error elsewhere in the file does not hide the error a fix adds:
// the Match chain's fix would compare "oauth" | "token" with "none", which
// is TS2367, so --fix refuses it with or without the stray `const broken = ;`.
func TestFixGateSeesErrorsBehindSyntaxError(t *testing.T) {
	const chain = "type Config = { readonly method: \"token\" | \"oauth\" }\n" +
		"export function kind(config: Config): string {\n" +
		"  return Match.value(config).pipe(\n" +
		"    Match.whenOr({ method: \"oauth\" }, { method: \"none\" }, (c) => c.method),\n" +
		"    Match.orElse(() => \"other\"),\n" +
		"  )\n" +
		"}\n"
	for name, source := range map[string]string{"alone": chain, "after a syntax error": chain + "const broken = ;\n"} {
		t.Run(name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, source)
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{})
			for _, fixed := range result.Files {
				t.Errorf("--fix wrote a fix that adds TS2367:\n%s", fixed.Text)
			}
			if len(result.Refused) != 1 {
				t.Errorf("want the Match chain's fix refused, got %+v", result.Refused)
			}
		})
	}
}
