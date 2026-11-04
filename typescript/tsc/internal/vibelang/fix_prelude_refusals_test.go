package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// A prelude rewrite the gate refused is refused again without a check in a
// later pass of the run while nothing the refusal read has changed
// (fix_prelude_refusals.go). On a 10-module slice of Smithers' apps/mvp each
// --fix run's second pass re-checked the 13 or 14 rewrites the first had
// refused (fixperf2-smithers, 2026-11-03). Here main.vibe's rewrite adds a
// type error and is refused; other.vibe's is kept, so a later pass's
// texts differ from the refusal's only in other.vibe.
func TestFixPreludeRefusalNotRechecked(t *testing.T) {
	const other = "export const second = 1\n"
	for _, tc := range []struct {
		name, main string
		again      bool // whether the refusal still holds after other.vibe changes
	}{
		{"other file changed", "export const first = 1\n", true},
		{"imported file changed", "import { second } from \"./other.vibe\"\nexport const first = second\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.main)
			dir := filepath.Dir(file.FileName().AsString())
			for name, text := range map[string]string{
				"other.vibe":    other,
				"globals.ts":    "export {}\ndeclare global {\n  var shared: number\n}\n",
				"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"include":["*.vibe","*.ts"]}`,
			} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			builds := 0
			parsed := &fixParsedFiles{}
			build := func(texts map[tspath.RootedFilePath]string) *compiler.Program {
				builds++
				return fixProgram(fs, bundled.LibPath(), config, parsed, texts)
			}
			name := func(base string) tspath.RootedFilePath {
				return tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, base)))
			}
			program := build(nil)
			g := &fixGate{ctx: t.Context(), done: t.Context(), baseline: baselineOf(t.Context(), program), build: build}
			appending := func(program *compiler.Program, base, text string) proposal {
				file := program.GetSourceFile(name(base))
				end := len(file.Text())
				return proposal{file: file, fixes: []fileFix{{edits: []sourceEdit{{end, end, text}}, key: "prelude: " + base}}}
			}
			const broken = "const invalid: string = 1\n"
			g.recordPrelude = true
			kept := g.accept(nil, []proposal{appending(program, "main.vibe", broken), appending(program, "other.vibe", "export const added = 2\n")}, func(FixRefusal, string) {})
			g.recordPrelude = false
			if len(kept) != 1 || kept[0].file.FileName() != name("other.vibe") || g.preludeRefusals[name("main.vibe")] == nil {
				t.Fatalf("kept %d proposals, refusals %v; want other.vibe kept and main.vibe refused", len(kept), g.preludeRefusals)
			}
			texts := map[tspath.RootedFilePath]string{name("other.vibe"): kept[0].text()}
			next := build(texts)
			offered := appending(next, "main.vibe", broken)
			checks := builds
			if got := g.stillRefused(fs, next, programFilesKey(next), texts, offered); got != tc.again {
				t.Fatalf("stillRefused = %v; want %v", got, tc.again)
			}
			if builds != checks {
				t.Fatalf("stillRefused checked %d programs", builds-checks)
			}
			// Without the memo the gate checks the rewrite again.
			if g.accept(texts, []proposal{offered}, func(FixRefusal, string) {}); builds == checks {
				t.Fatal("the gate decided a second offer without a check")
			}
			t.Logf("a second offer costs the gate %d checks", builds-checks)
			if !tc.again {
				return
			}
			// A changed file that declares globals is read by every refusal.
			texts[name("globals.ts")] = "export {}\ndeclare global {\n  var shared: string\n}\n"
			if next := build(texts); g.stillRefused(fs, next, programFilesKey(next), texts, appending(next, "main.vibe", broken)) {
				t.Fatal("stillRefused after a global declaration changed")
			}
			delete(texts, name("globals.ts"))
			// So is a change to the baseline of the refused file.
			next = build(texts)
			g.baseline = g.baseline.with(baselineOf(t.Context(), build(map[tspath.RootedFilePath]string{name("main.vibe"): tc.main + "const wrong: string = 1\n"})))
			if g.stillRefused(fs, next, programFilesKey(next), texts, appending(next, "main.vibe", broken)) {
				t.Fatal("stillRefused after the baseline of main.vibe changed")
			}
		})
	}
}
