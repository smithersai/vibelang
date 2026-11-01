package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
	_, file, _, _ := editorProgram(t, "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n")
	dir := filepath.Dir(file.FileName().AsString())
	for name, text := range map[string]string{
		"use.vibe":      "import { modes } from \"./main.vibe\"\nexport effect function use() {\n  const all = try modes()\n  all.push(\"slow\")\n  return all\n}\n",
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

// refusedMatchChain is a Match chain whose quick fix compares "oauth" | "token"
// with "none", TS2367 in the text the fix writes, so --fix refuses it.
const refusedMatchChain = "type Config = { readonly method: \"token\" | \"oauth\" }\n" +
	"export function kind(config: Config): string {\n" +
	"  return Match.value(config).pipe(\n" +
	"    Match.whenOr({ method: \"oauth\" }, { method: \"none\" }, (c) => c.method),\n" +
	"    Match.orElse(() => \"other\"),\n" +
	"  )\n" +
	"}\n"

// A round whose fixes add errors costs a few checks of the program however
// many fixes it refuses. Each refused fix here adds an error in the text it
// writes, which names it; one adds an error to another file, which reads a
// declaration the fix rewrote. Halving the round checked the program at
// least once per refused fix: t3code's packages/contracts, 99 refusals at
// about 5 s a check, took 1,896 s (2026-10-31).
func TestFixGateChecksAFewTimes(t *testing.T) {
	const files, refused = 32, 12
	_, file, _, _ := editorProgram(t, "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\nexport type B = Effect.Effect<number>\n")
	dir := filepath.Dir(file.FileName().AsString())
	write := func(name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for i := range files {
		text := fmt.Sprintf("export type T%d = Effect.Effect<number>\n", i)
		if i < refused {
			text += refusedMatchChain
		}
		write(fmt.Sprintf("f%02d.vibe", i), text)
	}
	write("more.vibe", "import { modes } from \"./main.vibe\"\nexport effect function more() {\n  const all = try modes()\n  all.push(\"slow\")\n  return all\n}\n")
	write("plain.ts", "export const plain = 1\n")
	write("tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`)
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	builds, fs := countingFS(dir, func(int) {})
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	var codes []string
	for _, r := range result.Refused {
		codes = append(codes, fmt.Sprintf("EK%04d", r.Code))
	}
	if len(result.Order) != files+1 || len(result.Refused) != refused+1 || result.Refused[0].Code != 4834 || !strings.Contains(result.Refused[0].Error, "more.vibe") {
		t.Fatalf("fixed %d files, refused %v %+v; want %d files, the EK4834 fix refused for an error in more.vibe, then %d Match chains", len(result.Order), codes, result.Refused, files+1, refused)
	}
	t.Logf("%d programs for %d refusals", *builds, refused+1)
	// The baseline, the round, the round without the fixes that hold
	// errors, two to find the fix more.vibe traces to, the rest again, the
	// fixes set aside, the next round, the prelude and the cleanup: ten, and
	// a few spare per refusal. Halving built 65, two or more per refusal.
	if limit := 10 + refused/4; *builds > limit {
		t.Fatalf("--fix built %d programs for %d refused fixes; want at most %d", *builds, refused+1, limit)
	}
}
