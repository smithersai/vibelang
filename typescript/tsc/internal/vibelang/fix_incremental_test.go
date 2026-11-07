package vibelang

import (
	"fmt"
	stdmaps "maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// fileChecksIn counts, by directory, the checks of the files in it whose
// name starts with a prefix; a test registers its directory and prefix
// (countFileChecks), so tests that run at once count apart.
var fileChecksIn sync.Map // directory + "/" + prefix -> *atomic.Int64

func init() {
	checker.RegisterSourceFileCheckHook(func(_ *checker.Checker, file *ast.SourceFile) {
		name := file.FileName().AsString()
		dir, base := filepath.Dir(name), filepath.Base(name)
		fileChecksIn.Range(func(key, value any) bool {
			at := key.(string)
			if prefixDir, prefix := filepath.Dir(at), filepath.Base(at); prefixDir == dir && strings.HasPrefix(base, prefix) {
				value.(*atomic.Int64).Add(1)
			}
			return true
		})
	})
}

// countFileChecks counts the checks of dir's files whose name starts with
// prefix until the test ends.
func countFileChecks(t *testing.T, dir, prefix string) *atomic.Int64 {
	t.Helper()
	key := filepath.Join(dir, prefix)
	count := &atomic.Int64{}
	fileChecksIn.Store(key, count)
	t.Cleanup(func() { fileChecksIn.Delete(key) })
	return count
}

// changedChecksProject writes a project of main.vibe, whose type nests
// Effect.Effect depth times so that each round of --fix rewrites one level
// (EK4833), and libs TypeScript modules lib00.ts and on, which import
// main.vibe when read is true.
func changedChecksProject(t *testing.T, mainSource string, libs int, read bool) (string, *tsoptions.ParsedCommandLine) {
	t.Helper()
	_, file, _, _ := editorProgram(t, mainSource)
	dir := filepath.Dir(file.FileName().AsString())
	files := map[string]string{
		"plain.ts":      "export const plain = 1\n",
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`,
	}
	for i := range libs {
		var b strings.Builder
		if read {
			b.WriteString("import type { Deep } from \"./main.vibe\"\nexport type Held = Deep\n")
		}
		fmt.Fprintf(&b, "export interface Row%d { readonly id: number; readonly name: string }\n", i)
		fmt.Fprintf(&b, "export function rows%d(n: number): ReadonlyArray<Row%d> {\n  return Array.from({ length: n }, (_, id) => ({ id, name: `row ${id}` }))\n}\n", i, i)
		files[fmt.Sprintf("lib%02d.ts", i)] = b.String()
	}
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return dir, config
}

// deepType is a module that exports a type nesting Effect.Effect depth
// times, which --fix rewrites one level a round.
func deepType(depth int) string {
	return "export type Deep = " + strings.Repeat("Effect.Effect<Array<", depth) + "number" + strings.Repeat(">>", depth) + "\n"
}

// sameFixes describes how two --fix results differ in the files they write,
// the fixes they count and the refusals they report, or returns "".
func sameFixes(a, b *FixResult) string {
	if (a.Err == nil) != (b.Err == nil) {
		return fmt.Sprintf("errors %v and %v", a.Err, b.Err)
	}
	if !slices.Equal(a.Order, b.Order) {
		return fmt.Sprintf("files %v and %v", a.Order, b.Order)
	}
	for name, fa := range a.Files {
		fb := b.Files[name]
		if fa.Text != fb.Text || !stdmaps.Equal(fa.Counts, fb.Counts) || !stdmaps.Equal(fa.Rewrites, fb.Rewrites) || !stdmaps.Equal(fa.NativeCounts, fb.NativeCounts) {
			return fmt.Sprintf("%s:\n%s\nand:\n%s", name, fa.Text, fb.Text)
		}
	}
	if !slices.Equal(a.Refused, b.Refused) {
		return fmt.Sprintf("refusals %+v and %+v", a.Refused, b.Refused)
	}
	if !slices.Equal(a.Sites, b.Sites) {
		return fmt.Sprintf("sites %+v and %+v", a.Sites, b.Sites)
	}
	return ""
}

// A round that fixes one module checks that module and the files that
// import it, not the project: the project's other files reported no error
// in the last check and read nothing the round changed. Each round of a
// 25-module batch of Smithers' apps/mvp worker checked its 2,392 files to
// keep a few fixes in one to eight of them (2026-11-07). The run writes
// what a run that checks the whole program for each trial writes.
func TestFixChecksTheReadersOfAChange(t *testing.T) {
	const depth, libs = 6, 30
	dir, config := changedChecksProject(t, deepType(depth), libs, false)
	checks := countFileChecks(t, dir, "lib")
	result := FixProject(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config)
	if result.Err != nil || len(result.Order) != 1 || result.Files[result.Order[0]].Counts[4833] != depth {
		t.Fatalf("fixed %v, error %v; want main.vibe's %d EK4833 fixes", result.Order, result.Err, depth)
	}
	t.Logf("%d checks of %d unrelated modules in %d rounds", checks.Load(), libs, depth)
	// The baseline checks each once. A run that checks the whole program for
	// each round's fixes checks each depth times more.
	if n := checks.Load(); n > 2*libs {
		t.Fatalf("--fix checked %d unrelated modules %d times in %d rounds; want at most %d", libs, n, depth, 2*libs)
	}
	whole := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, FixOptions{Checks: FixChecksWhole})
	if diff := sameFixes(result, whole); diff != "" {
		t.Fatalf("a run that checks changed files and one that checks the whole program differ: %s", diff)
	}
}

// A file that imports a changed module reads it, so each round checks it
// again, and a change it then reports is the round's to refuse.
func TestFixChecksTheImportersOfAChange(t *testing.T) {
	const depth, libs = 3, 4
	dir, config := changedChecksProject(t, deepType(depth), libs, true)
	checks := countFileChecks(t, dir, "lib")
	result := FixProject(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config)
	if result.Err != nil || len(result.Order) != 1 {
		t.Fatalf("fixed %v, error %v; want main.vibe fixed", result.Order, result.Err)
	}
	if n := checks.Load(); n < int64(libs*(depth+1)) {
		t.Fatalf("--fix checked the %d importers of main.vibe %d times in %d rounds; want each once a round and once for the baseline", libs, n, depth)
	}
	whole := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, FixOptions{Checks: FixChecksWhole})
	if diff := sameFixes(result, whole); diff != "" {
		t.Fatalf("a run that checks changed files and one that checks the whole program differ: %s", diff)
	}
}

// A global declaration is one every file reads, so a round that changes a
// file that declares one checks the whole program.
func TestFixChecksTheWholeProgramWhenAChangeDeclaresGlobals(t *testing.T) {
	const depth, libs = 3, 4
	global := "export {}\ndeclare global {\n  " + strings.Replace(deepType(depth), "export type Deep", "type Deep", 1) + "}\n"
	dir, config := changedChecksProject(t, global, libs, false)
	checks := countFileChecks(t, dir, "lib")
	result := FixProject(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config)
	if result.Err != nil || len(result.Order) != 1 {
		t.Fatalf("fixed %v, error %v; want main.vibe fixed", result.Order, result.Err)
	}
	if n := checks.Load(); n < int64(libs*(depth+1)) {
		t.Fatalf("--fix checked %d modules %d times in %d rounds that changed a global declaration; want each once a round and once for the baseline", libs, n, depth)
	}
}

// What VibeLang reads from every file of a program, the keys of its
// service classes, decides whether a change may be checked in its readers
// only.
func TestFixCrossFileFactsNameServiceKeys(t *testing.T) {
	facts := func(source string) string {
		_, file, _, _ := editorProgram(t, source)
		return crossFileFacts(file)
	}
	service := "export service Clock { static readonly key = \"app/Clock\"; now: number }\n"
	if facts(service) == "" {
		t.Fatal("a service class is not a cross-file fact")
	}
	if a, b := facts(service), facts(strings.Replace(service, "app/Clock", "app/Timer", 1)); a == b {
		t.Fatalf("a service key change keeps the facts %q", a)
	}
	if a, b := facts(service), facts(service+"export const other = 1\n"); a != b {
		t.Fatalf("an unrelated declaration changes the facts from %q to %q", a, b)
	}
	if got := facts("export function plain(n: number): number { return n }\n"); got != "" {
		t.Fatalf("a module without service classes has facts %q", got)
	}
}

// An export changes the modules that name a type in another file's error,
// so a change of what a file exports checks the files that reported errors.
func TestFixExportSurfaceNamesExports(t *testing.T) {
	surface := func(source string) string {
		_, file, _, _ := editorProgram(t, source)
		return exportSurface(file)
	}
	base := "export function f(n: number): number { return n }\nconst hidden = 1\n"
	if a, b := surface(base), surface(strings.Replace(base, "return n", "return n + 1", 1)); a != b {
		t.Fatalf("a body edit changes the export surface from %q to %q", a, b)
	}
	for _, edit := range []string{
		base + "export { hidden }\n",
		base + "export * from \"./other.vibe\"\n",
		strings.Replace(base, "export function f", "export function g", 1),
		strings.Replace(base, "const hidden", "export const hidden", 1),
	} {
		if surface(base) == surface(edit) {
			t.Errorf("%q has the export surface of %q", edit, base)
		}
	}
}

// A signature leaves out function bodies, which a fix rewrites without
// changing what an importer reads; VibeLang's for concurrent reparses its
// head into nodes out of source order, which once cut a slice backwards.
func TestFixExportHeadersLeaveOutBodies(t *testing.T) {
	headers := func(source string) string {
		_, file, _, _ := editorProgram(t, source)
		return exportHeaders(file)
	}
	concurrent := "export effect function f() { let value = 'outer'; let read: () => string = () => ''; for concurrent (const value of (read = (): string => value.toUpperCase(), [1])) { const item = { value }; void item } value = 'later'; return read }\n"
	if got, want := headers(concurrent), "export effect function f() {}\n"; got != want {
		t.Fatalf("headers %q; want %q", got, want)
	}
	arrow := "export const g = (n: number): number => {\n  return n + 1\n}\nconst hidden = 1\n"
	if got, want := headers(arrow), "export const g = (n: number): number => {}\n"; got != want {
		t.Fatalf("headers %q; want %q", got, want)
	}
	if a, b := headers(arrow), headers(strings.Replace(arrow, "n + 1", "n + 2", 1)); a != b {
		t.Fatalf("a body edit changes the headers from %q to %q", a, b)
	}
	if a, b := headers(arrow), headers(strings.Replace(arrow, "): number", "): number | string", 1)); a == b {
		t.Fatalf("a return type edit keeps the headers %q", a)
	}
}

// The gate's checks of changed files find the errors a check of the whole
// program finds, on the projects the gate's own tests refuse fixes in:
// VIBELANG_FIX_CHECKS=verify checks both and says where they differ.
func TestFixChangedChecksAgreeWithWholeChecks(t *testing.T) {
	for _, project := range []struct {
		name  string
		build func(*testing.T) *tsoptions.ParsedCommandLine
	}{
		{"cross-file refusal", func(t *testing.T) *tsoptions.ParsedCommandLine { _, config := fixFiles(t); return config }},
		// A file the rounds do not read reports an error throughout: a check
		// of changed files reports it as the last check did.
		{"unrelated error", func(t *testing.T) *tsoptions.ParsedCommandLine {
			dir, _ := changedChecksProject(t, deepType(3)+"export type Wide = Effect.Effect<number>\n", 6, false)
			if err := os.WriteFile(filepath.Join(dir, "wrong.ts"), []byte("export const wrong: number = \"text\"\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			return config
		}},
		{"halving", func(t *testing.T) *tsoptions.ParsedCommandLine { _, config := scaleProject(t, 40, true); return config }},
		{"traced", func(t *testing.T) *tsoptions.ParsedCommandLine {
			_, config := scaleProject(t, 40, false)
			return config
		}},
	} {
		t.Run(project.name, func(t *testing.T) {
			config := project.build(t)
			var progress strings.Builder
			verified := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, FixOptions{Checks: FixChecksVerify, Progress: &progress, ProgressEvery: time.Hour})
			if strings.Contains(progress.String(), "found other errors") {
				t.Fatalf("checks of changed files and of the whole program differ:\n%s", progress.String())
			}
			changed := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, FixOptions{})
			whole := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, FixOptions{Checks: FixChecksWhole})
			if diff := sameFixes(changed, whole); diff != "" {
				t.Fatalf("a run that checks changed files and one that checks the whole program differ: %s", diff)
			}
			if diff := sameFixes(verified, whole); diff != "" {
				t.Fatalf("a verifying run and one that checks the whole program differ: %s", diff)
			}
		})
	}
}

// VIBELANG_FIX_CHECKS names how the gate checks a trial: unset, whole or
// verify; another value is an error, not a guess.
func TestFixChecksFromEnvironment(t *testing.T) {
	for value, want := range map[string]FixChecks{"": FixChecksChanged, "whole": FixChecksWhole, "verify": FixChecksVerify} {
		t.Setenv("VIBELANG_FIX_CHECKS", value)
		if got, err := fixChecksFromEnvironment(); err != nil || got != want {
			t.Errorf("VIBELANG_FIX_CHECKS=%q: %v, %v; want %v", value, got, err, want)
		}
	}
	t.Setenv("VIBELANG_FIX_CHECKS", "changed")
	if _, err := fixChecksFromEnvironment(); err == nil {
		t.Error("VIBELANG_FIX_CHECKS=changed is not an error")
	}
}
