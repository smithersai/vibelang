package vibelang

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
)

// fixFiles is a project of 32 files with a safe fix each. One fix adds an
// error to another file, which has no fix: a running Effect.succeed("fast")
// is a string, while the literal alone has the type "fast", which the
// other file's push of "slow" into the array modes returns does not fit. Each round's fixes together are
// refused, and the error names no file that holds the fix that adds it.
func fixFiles(t *testing.T) (string, *tsoptions.ParsedCommandLine) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export function modes() {\n  const mode = Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\nexport type B = Effect.Effect<number>\n")
	dir := filepath.Dir(file.FileName().AsString())
	write := func(name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for i := range 31 {
		write(fmt.Sprintf("f%02d.vibe", i), fmt.Sprintf("export type T%d = Effect.Effect<number>\n", i))
	}
	write("more.vibe", "import { modes } from \"./main.vibe\"\nexport function more() {\n  const all = modes()\n  all.push(\"slow\")\n  return all\n}\n")
	write("plain.ts", "export const plain = 1\n")
	write("tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`)
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return dir, config
}

// countingFS counts the programs FixProject builds, by the reads of a file
// that no fix changes, and calls onRead with the count.
func countingFS(dir string, onRead func(int)) (*int, vfs.FS) {
	fs := bundled.WrapFS(osvfs.FS())
	plain := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "plain.ts")))
	builds := new(int)
	return builds, wrapvfs.Wrap(fs, wrapvfs.Replacements{ReadFile: func(name tspath.RootedFilePath) (string, bool) {
		if name == plain {
			*builds++
			onRead(*builds)
		}
		return fs.ReadFile(name)
	}})
}

// When a round's fixes together add an error, --fix finds the files that
// add it by halving the round, not by checking the program once per file.
func TestFixProjectBoundsChecks(t *testing.T) {
	dir, config := fixFiles(t)
	builds, fs := countingFS(dir, func(int) {})
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	if len(result.Order) != 32 || len(result.Refused) != 1 || result.Refused[0].Code != 4834 || !strings.Contains(result.Refused[0].Error, "more.vibe") {
		t.Fatalf("fixed %d files, refused %+v; want 32 files and the EK4834 fix refused for an error in more.vibe", len(result.Order), result.Refused)
	}
	t.Logf("%d programs", *builds)
	// One program per round, the baseline's, and about two per halving of
	// the 32 files and of main.vibe's two fixes; one per file is over 32.
	if *builds > 20 {
		t.Fatalf("--fix built %d programs for 32 files", *builds)
	}
}

// The programs of a --fix run share the parsed files no fix edited. Each
// round and trial builds a program, and parsing the libraries and packages
// again for each of them took rewrite-deep-types' 20 rounds past its 30 s
// limit on a busy host.
func TestFixProgramsShareParsedFiles(t *testing.T) {
	dir, config := fixFiles(t)
	fs := bundled.WrapFS(osvfs.FS())
	edited := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "f00.vibe")))
	parsed := &fixParsedFiles{}
	first := fixProgram(fs, bundled.LibPath(), config, parsed, nil)
	text := "export type T0 = number!!\n"
	second := fixProgram(fs, bundled.LibPath(), config, parsed, map[tspath.RootedFilePath]string{edited: text})
	if got := second.GetSourceFile(edited).Text(); got != text {
		t.Fatalf("the edited program read %q", got)
	}
	shared := 0
	for _, file := range first.SourceFiles() {
		if file.FileName() == edited {
			continue
		}
		if second.GetSourceFile(file.FileName()) != file {
			t.Errorf("%s was parsed again", file.FileName())
		}
		shared++
	}
	if shared <= len(fixableFiles(first)) {
		t.Fatalf("%d files shared; the libraries are among them", shared)
	}
	if got := fixProgram(fs, bundled.LibPath(), config, parsed, nil).GetSourceFile(edited).Text(); got == text {
		t.Fatalf("a program without the edit read the edited text %q", got)
	}
}

// An interrupted --fix stops at the next program, without a panic.
func TestFixProjectStopsWhenCanceled(t *testing.T) {
	dir, config := fixFiles(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	builds, fs := countingFS(dir, func(n int) {
		if n == 3 {
			cancel()
		}
	})
	FixProject(ctx, fs, bundled.LibPath(), config)
	if *builds != 3 {
		t.Fatalf("--fix built %d programs after it was canceled during the third", *builds)
	}
}
