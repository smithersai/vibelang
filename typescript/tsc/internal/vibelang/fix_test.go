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
// error to another file, which has no fix: try Effect.succeed("fast")
// is a string, while the literal alone has the type "fast", which the
// other file's push of "slow" into the array modes returns does not fit. Each round's fixes together are
// refused, and the error names no file that holds the fix that adds it.
func fixFiles(t *testing.T) (string, *tsoptions.ParsedCommandLine) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\nexport type B = Effect.Effect<number>\n")
	dir := filepath.Dir(file.FileName().AsString())
	write := func(name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for i := range 31 {
		write(fmt.Sprintf("f%02d.vibe", i), fmt.Sprintf("export type T%d = Effect.Effect<number>\n", i))
	}
	write("more.vibe", "import { modes } from \"./main.vibe\"\nexport effect function more() {\n  const all = try modes()\n  all.push(\"slow\")\n  return all\n}\n")
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

// When a round's fixes together add an error, --fix finds the fix that
// adds it from the declaration the error reads, not by checking the
// program once per file.
func TestFixProjectBoundsChecks(t *testing.T) {
	dir, config := fixFiles(t)
	builds, fs := countingFS(dir, func(int) {})
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	if len(result.Order) != 32 || len(result.Refused) != 1 || result.Refused[0].Code != 4834 || !strings.Contains(result.Refused[0].Error, "more.vibe") {
		t.Fatalf("fixed %d files, refused %+v; want 32 files and the EK4834 fix refused for an error in more.vibe", len(result.Order), result.Refused)
	}
	t.Logf("%d programs", *builds)
	// The baseline, the round, two to find the fix that more.vibe's error
	// traces to, the rest again, the next round and the prelude: about
	// eight. Halving the 32 files built 17; one per file is over 32.
	if *builds > 10 {
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

// The programs of a --fix run share their module resolutions. A run builds
// a program for each round and trial. When the set of created files is
// unchanged, each import resolves as it did before. Resolving every
// import again for each program took 11 to 15% of the CPU time of a
// --fix run on a Smithers apps/mvp slice, half of it in stat calls
// (fixperf-smithers, 2026-11-03).
func TestFixProgramsShareModuleResolutions(t *testing.T) {
	dir, config := fixFiles(t)
	plain := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "plain.ts")))
	// counting returns a file system that counts the programs built, by
	// the reads of plain.ts, which no fix changes, and the lookups of a
	// file in a node_modules directory, which only resolving an import
	// such as "effect" makes.
	counting := func() (*int, *int, vfs.FS) {
		fs := bundled.WrapFS(osvfs.FS())
		builds, lookups := new(int), new(int)
		return builds, lookups, wrapvfs.Wrap(fs, wrapvfs.Replacements{
			ReadFile: func(name tspath.RootedFilePath) (string, bool) {
				if name == plain {
					*builds++
				}
				return fs.ReadFile(name)
			},
			FileExists: func(name tspath.RootedFilePath) bool {
				if strings.Contains(name.AsString(), "/node_modules/") {
					*lookups++
				}
				return fs.FileExists(name)
			},
		})
	}
	_, once, fs := counting()
	fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, nil)
	if *once == 0 {
		t.Fatal("a program build looked up no file in node_modules")
	}
	builds, lookups, fs := counting()
	FixProject(t.Context(), fs, bundled.LibPath(), config)
	if *builds < 3 {
		t.Fatalf("the run built %d programs; the test needs several", *builds)
	}
	// Concurrent loading can look a file up twice; a run that resolves
	// again for each program looks up about once per program.
	if *lookups >= 2**once {
		t.Fatalf("a --fix run that built %d programs looked up %d files in node_modules; one program looks up %d", *builds, *lookups, *once)
	}
}

// A fix can create a file (fix_platform_wrappers.go), so the programs of a
// run do not all see the same files: an import of the file resolves in
// the programs that hold it, and in no others, whichever came first. The
// shared resolver of TestFixProgramsShareModuleResolutions must not carry
// an answer from one to the other (fixperf-smithers, 2026-11-03).
func TestFixProgramsResolveCreatedFiles(t *testing.T) {
	dir, config := fixFiles(t)
	fs := bundled.WrapFS(osvfs.FS())
	path := func(name string) tspath.RootedFilePath {
		return tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, name)))
	}
	imports := "import { made } from \"./made.js\"\nexport const plain = made\n"
	without := map[tspath.RootedFilePath]string{path("plain.ts"): imports}
	with := map[tspath.RootedFilePath]string{path("plain.ts"): imports, path("made.ts"): "export const made = 1\n"}
	parsed := &fixParsedFiles{}
	for i, step := range []struct {
		overlay  map[tspath.RootedFilePath]string
		resolved bool
	}{{without, false}, {with, true}, {without, false}, {with, true}} {
		program := fixProgram(fs, bundled.LibPath(), config, parsed, step.overlay)
		resolved := true
		for _, d := range program.GetSemanticDiagnostics(t.Context(), program.GetSourceFile(path("plain.ts"))) {
			if d.Code() == 2307 {
				resolved = false
			}
		}
		if resolved != step.resolved {
			t.Fatalf("program %d: import of the created file resolved = %v, want %v", i, resolved, step.resolved)
		}
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
