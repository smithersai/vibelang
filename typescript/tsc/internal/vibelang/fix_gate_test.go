package vibelang

import (
	"os"
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

// The gate checks a suspect file's fixes against that file, but a fix can add
// an error only to a file that imports it: here the literal type of "fast"
// reaches use.vibe. The check of the whole program still refuses that fix.
func TestFixGateSeesErrorsInOtherFiles(t *testing.T) {
	_, file, _, _ := editorProgram(t, "export function modes() {\n  const mode = Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n")
	dir := filepath.Dir(file.FileName().AsString())
	for name, text := range map[string]string{
		"use.vibe":      "import { modes } from \"./main.vibe\"\nexport function use() {\n  const all = modes()\n  all.push(\"slow\")\n  return all\n}\n",
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"files":["main.vibe","use.vibe"]}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	result := fixCase(t, dir)
	if fixed := result.Files[file.FileName()]; fixed != nil && fixed.Counts[4834] != 0 {
		t.Fatalf("--fix wrote a fix that adds an error to use.vibe:\n%s", fixed.Text)
	}
	if len(result.Refused) != 1 || result.Refused[0].Code != 4834 {
		t.Fatalf("refused %+v, want EK4834", result.Refused)
	}
}
