package vibelang

import (
	"fmt"
	stdmaps "maps"
	"math/rand/v2"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// onlyProject writes a project holding files, beside the main.vibe every
// editorProgram project has, and returns its directory.
func onlyProject(t *testing.T, files map[string]string) string {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export const main = 1\n")
	dir := filepath.Dir(file.FileName().AsString())
	config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// projectBytes reads every file of dir, by name relative to it.
func projectBytes(t *testing.T, dir string) map[string]string {
	t.Helper()
	texts := map[string]string{}
	err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		text, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		name, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		texts[filepath.ToSlash(name)] = string(text)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return texts
}

// runFix runs vibelang --fix on dir with args as the command line gives
// them, in dir, and returns its status and system.
func runFix(t *testing.T, dir string, args ...string) (int, *fixSys) {
	t.Helper()
	rest, options := FixOptionsArguments(slices.Concat(args, []string{"-p", dir}))
	sys := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
	return FixWithOptions(t.Context(), sys, rest, options), sys
}

const (
	onlyFixableA = "export type A = Effect.Effect<number>\n"
	onlyFixableB = "export type B = Effect.Effect<string>\n"
)

// expectChanged fails unless the files of after that differ from before are
// exactly want, each changed file named once.
func expectChanged(t *testing.T, before, after map[string]string, want ...string) {
	t.Helper()
	var changed []string
	for name, text := range after {
		if before[name] != text {
			changed = append(changed, name)
		}
	}
	for name := range before {
		if _, ok := after[name]; !ok {
			changed = append(changed, name)
		}
	}
	if !sameNames(changed, want) {
		t.Fatalf("changed %v, want %v", changed, want)
	}
}

func sameNames(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := map[string]int{}
	for _, name := range a {
		seen[name]++
	}
	for _, name := range b {
		seen[name]--
	}
	for _, n := range seen {
		if n != 0 {
			return false
		}
	}
	return true
}

// Both modules offer a fix. --only a.vibe writes the fix plain --fix writes
// to a.vibe, and leaves every other file the same bytes. A second run that
// lists b.vibe finishes the project as plain --fix does.
func TestFixOnlyRewritesOnlyListedModules(t *testing.T) {
	files := map[string]string{"a.vibe": onlyFixableA, "b.vibe": onlyFixableB}
	whole := onlyProject(t, files)
	status, plain := runFix(t, whole)
	if status != 0 {
		t.Fatalf("plain --fix: status %d, %s", status, plain.stderr.String())
	}
	if strings.Contains(plain.stdout.String(), "partial repair") {
		t.Fatalf("plain --fix calls itself partial: %q", plain.stdout.String())
	}
	fixed := projectBytes(t, whole)
	if fixed["a.vibe"] == onlyFixableA || fixed["b.vibe"] == onlyFixableB {
		t.Fatalf("plain --fix left a module: %v", fixed)
	}

	dir := onlyProject(t, files)
	before := projectBytes(t, dir)
	status, sys := runFix(t, dir, "--only", "a.vibe")
	if status != 0 {
		t.Fatalf("--only a.vibe: status %d, %s", status, sys.stderr.String())
	}
	after := projectBytes(t, dir)
	expectChanged(t, before, after, "a.vibe")
	if after["a.vibe"] != fixed["a.vibe"] {
		t.Fatalf("a.vibe is %q, plain --fix writes %q", after["a.vibe"], fixed["a.vibe"])
	}
	if out := sys.stdout.String(); !strings.Contains(out, "a.vibe") || strings.Contains(out, "b.vibe") {
		t.Fatalf("the report names the wrong files: %q", out)
	}
	if out := sys.stdout.String(); !strings.Contains(out, "partial repair") {
		t.Fatalf("the report does not say the repair is partial: %q", out)
	}
	if status, sys := runFix(t, dir, "--only", "b.vibe"); status != 0 {
		t.Fatalf("--only b.vibe: status %d, %s", status, sys.stderr.String())
	}
	if done := projectBytes(t, dir); !stdmaps.Equal(done, fixed) {
		t.Fatalf("after both lists the project is %v, plain --fix writes %v", done, fixed)
	}
}

// What an unlisted module reports does not decide what a listed module gets.
// The last case is the sharp one: the fix of main.vibe narrows the array
// more.vibe pushes "slow" onto, so plain --fix refuses it, and --only keeps
// it; the compilation after --fix reports the error in more.vibe.
func TestFixOnlyIgnoresUnlistedDiagnostics(t *testing.T) {
	const modes = "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n"
	for name, unlisted := range map[string]string{
		"clean":          "export const b = 1\n",
		"own error":      "export const b: string = 1\n",
		"fixable":        onlyFixableB,
		"both":           onlyFixableB + "export const b: string = 1\n",
		"a syntax error": "export const = 1\n",
		"imports it":     "import { modes } from \"./a.vibe\"\nexport effect function more() {\n  const all = try modes()\n  all.push(\"slow\")\n  return all\n}\n",
	} {
		t.Run(name, func(t *testing.T) {
			alone := onlyProject(t, map[string]string{"a.vibe": modes})
			if status, sys := runFix(t, alone, "--only", "a.vibe"); status != 0 {
				t.Fatalf("alone: status %d, %s", status, sys.stderr.String())
			}
			want := projectBytes(t, alone)["a.vibe"]
			if want == modes {
				t.Fatal("a.vibe offers no fix")
			}
			dir := onlyProject(t, map[string]string{"a.vibe": modes, "b.vibe": unlisted})
			before := projectBytes(t, dir)
			if status, sys := runFix(t, dir, "--only", "a.vibe"); status != 0 {
				t.Fatalf("status %d, %s", status, sys.stderr.String())
			}
			after := projectBytes(t, dir)
			expectChanged(t, before, after, "a.vibe")
			if after["a.vibe"] != want {
				t.Fatalf("a.vibe is %q beside this module, %q alone", after["a.vibe"], want)
			}
		})
	}
}

// A run stopped at any moment leaves every unlisted module the same bytes.
// A second run finishes the listed modules as a run never stopped does.
func TestFixOnlyStoppedLeavesUnlistedModules(t *testing.T) {
	const modules, good = 20, 2
	var list []string
	for i := range modules / 2 {
		list = append(list, fmt.Sprintf("m%03d.vibe", i))
	}
	only := strings.Join(list, ",")
	whole, _ := isolationProject(t, modules, good)
	if status, sys := runFix(t, whole, "--only", only); status != 0 {
		t.Fatalf("a run never stopped: status %d, %s", status, sys.stderr.String())
	}
	final := vibeFiles(t, whole)
	for _, at := range []int{2, 4} {
		t.Run(fmt.Sprintf("program %d", at), func(t *testing.T) {
			dir, _ := isolationProject(t, modules, good)
			before := projectBytes(t, dir)
			ctx, stop := signal.NotifyContext(t.Context(), syscall.SIGTERM)
			defer stop()
			_, fs := countingFS(dir, func(n int) {
				if n != at {
					return
				}
				if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
					t.Error(err)
				}
				select {
				case <-ctx.Done():
				case <-time.After(10 * time.Second):
					t.Error("the signal did not arrive")
				}
			})
			rest, options := FixOptionsArguments([]string{"--only", only, "-p", dir})
			sys := &fixSys{fs: fs, cwd: dir}
			status := FixWithOptions(ctx, sys, rest, options)
			stop()
			fixRuns.Wait()
			if status == 0 || !strings.Contains(sys.stderr.String(), "interrupted; ") {
				t.Fatalf("status %d, stderr %q; want the run stopped", status, sys.stderr.String())
			}
			after := projectBytes(t, dir)
			for name, text := range before {
				if !slices.Contains(list, name) && after[name] != text {
					t.Errorf("the stopped run changed %s", name)
				}
			}
			if status, sys := runFix(t, dir, "--only", only); status != 0 {
				t.Fatalf("the second run: status %d, %s", status, sys.stderr.String())
			}
			if again := vibeFiles(t, dir); !stdmaps.Equal(again, final) {
				t.Fatalf("the second run wrote %v, a run never stopped writes %v", again, final)
			}
		})
	}
}

// Every form of the list selects by file, whichever way it names the file.
func TestFixOnlyListForms(t *testing.T) {
	files := map[string]string{
		"a.vibe": onlyFixableA,
		"b.vibe": onlyFixableB,
		"one":    "\n  a.vibe  \r\n\n",
		"two":    "a.vibe\nb.vibe\n",
	}
	for _, c := range []struct {
		name string
		args func(dir string) []string
		want []string
	}{
		{"one", func(string) []string { return []string{"--only", "a.vibe"} }, []string{"a.vibe"}},
		{"either case", func(string) []string { return []string{"--ONLY", "a.vibe"} }, []string{"a.vibe"}},
		{"dotted", func(string) []string { return []string{"--only", "./x/../a.vibe"} }, []string{"a.vibe"}},
		{"absolute", func(dir string) []string { return []string{"--only", filepath.Join(dir, "a.vibe")} }, []string{"a.vibe"}},
		{"named twice", func(string) []string { return []string{"--only", "a.vibe,a.vibe"} }, []string{"a.vibe"}},
		{"through a link", func(string) []string { return []string{"--only", "link/a.vibe"} }, []string{"a.vibe"}},
		{"comma list", func(string) []string { return []string{"--only", "a.vibe,b.vibe"} }, []string{"a.vibe", "b.vibe"}},
		{"repeated", func(string) []string { return []string{"--only", "a.vibe", "--only", "b.vibe"} }, []string{"a.vibe", "b.vibe"}},
		{"list file", func(string) []string { return []string{"--only", "@one"} }, []string{"a.vibe"}},
		{"list file of two", func(string) []string { return []string{"--only", "@two"} }, []string{"a.vibe", "b.vibe"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			dir := onlyProject(t, files)
			if err := os.Symlink(dir, filepath.Join(dir, "link")); err != nil {
				t.Fatal(err)
			}
			before := projectBytes(t, dir)
			status, sys := runFix(t, dir, c.args(dir)...)
			if status != 0 {
				t.Fatalf("status %d, %s", status, sys.stderr.String())
			}
			expectChanged(t, before, projectBytes(t, dir), c.want...)
		})
	}
}

// A list that cannot mean what it says stops the run before it writes: a
// typo that fixed nothing and exited 0 would read as a clean module.
func TestFixOnlyRefusesBadLists(t *testing.T) {
	for name, args := range map[string][]string{
		"no value":             {"--only"},
		"missing":              {"--only", "missing.vibe"},
		"one of two missing":   {"--only", "a.vibe,missing.vibe"},
		"TypeScript":           {"--only", "plain.ts"},
		"outside the project":  {"--only", "../elsewhere.vibe"},
		"unreadable list":      {"--only", "@missing.txt"},
		"--fix-vip-only":       {"--fix-vip-only", "--only", "a.vibe"},
		"--fix-migration-only": {"--fix-migration-only", "--only", "a.vibe"},
		"empty value":          {"--only", ","},
		"empty list file":      {"--only", "@nothing"},
	} {
		t.Run(name, func(t *testing.T) {
			dir := onlyProject(t, map[string]string{"a.vibe": onlyFixableA, "b.vibe": onlyFixableB, "plain.ts": "export const plain = 1\n", "nothing": "\n"})
			before := projectBytes(t, dir)
			status, sys := runFix(t, dir, args...)
			if status == 0 || !strings.Contains(sys.stderr.String(), "--only") {
				t.Fatalf("status %d, stderr %q; want a refusal naming --only", status, sys.stderr.String())
			}
			expectChanged(t, before, projectBytes(t, dir))
		})
	}
}

// Plain --fix migrates a legacy severity setting in the project's config. A
// list names no config, so a listed run leaves it for the compilation.
func TestFixOnlyLeavesConfig(t *testing.T) {
	const config = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"vibelang":{"diagnostics":{"EK4609":"off"}},"include":["*.vibe","*.ts"]}`
	plain := onlyProject(t, map[string]string{"a.vibe": onlyFixableA, "tsconfig.json": config})
	if status, sys := runFix(t, plain); status != 0 {
		t.Fatalf("plain --fix: status %d, %s", status, sys.stderr.String())
	}
	if projectBytes(t, plain)["tsconfig.json"] == config {
		t.Fatal("plain --fix no longer migrates the config: this test proves nothing")
	}
	dir := onlyProject(t, map[string]string{"a.vibe": onlyFixableA, "tsconfig.json": config})
	before := projectBytes(t, dir)
	if status, sys := runFix(t, dir, "--only", "a.vibe"); status != 0 {
		t.Fatalf("--only: status %d, %s", status, sys.stderr.String())
	}
	expectChanged(t, before, projectBytes(t, dir), "a.vibe")
}

// The keeper is the only writer, so it holds the list's promise even if a
// rewrite that names another file is added later.
func TestFixKeeperRefusesAnUnlistedFile(t *testing.T) {
	dir := onlyProject(t, map[string]string{"a.vibe": onlyFixableA, "b.vibe": onlyFixableB})
	before := projectBytes(t, dir)
	name := func(base string) tspath.RootedFilePath {
		return tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, base)))
	}
	sys := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
	stopped := false
	keeper := &fixKeeper{sys: sys, scope: newFixScope(sys.fs, []tspath.RootedFilePath{name("a.vibe")}), stop: func() { stopped = true }, last: map[tspath.RootedFilePath]string{}, original: map[tspath.RootedFilePath]string{}}
	keeper.keep(map[tspath.RootedFilePath]string{name("b.vibe"): onlyFixableB})
	if keeper.err != nil {
		t.Fatalf("an unchanged unlisted file was refused: %v", keeper.err)
	}
	keeper.keep(map[tspath.RootedFilePath]string{name("a.vibe"): "export const a = 1\n", name("b.vibe"): "export const b = 1\n"})
	if keeper.err == nil || !stopped {
		t.Fatalf("err %v, stopped %v; want the run stopped", keeper.err, stopped)
	}
	expectChanged(t, before, projectBytes(t, dir))
}

// onlyModule is one module of a random project. Every module exports T<i>,
// so any can import any other.
func onlyModule(rng *rand.Rand, i, modules int) string {
	var b strings.Builder
	if j := rng.IntN(modules); j != i && rng.IntN(2) == 0 {
		fmt.Fprintf(&b, "import type { T%d } from \"./m%d.vibe\"\nexport type V%d = T%d\n", j, j, i, j)
	}
	switch rng.IntN(4) {
	case 0:
		fmt.Fprintf(&b, "export type T%d = number\n", i)
	case 1:
		fmt.Fprintf(&b, "export type T%d = Effect.Effect<number>\n", i)
	case 2:
		fmt.Fprintf(&b, "export type T%d = Effect.Effect<Effect.Effect<string>>\n", i)
	default:
		fmt.Fprintf(&b, "export type T%d = Effect.Effect<number>\nexport effect function modes%d() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n", i, i)
	}
	return b.String()
}

// For random projects and lists: unlisted files stay the same bytes, errors
// added to unlisted modules change no listed module, and a second run over
// the same list writes nothing.
func TestFixOnlyProperty(t *testing.T) {
	rng := rand.New(rand.NewPCG(20261103, 35))
	for run := range 6 {
		modules := 2 + rng.IntN(4)
		files := map[string]string{}
		var list []string
		for i := range modules {
			name := fmt.Sprintf("m%d.vibe", i)
			files[name] = onlyModule(rng, i, modules)
			if rng.IntN(2) == 0 {
				list = append(list, name)
			}
		}
		if len(list) == 0 {
			list = append(list, "m0.vibe")
		}
		only := strings.Join(list, ",")
		t.Run(fmt.Sprintf("%d %s", run, only), func(t *testing.T) {
			dir := onlyProject(t, files)
			before := projectBytes(t, dir)
			if status, sys := runFix(t, dir, "--only", only); status != 0 {
				t.Fatalf("status %d, %s\n%v", status, sys.stderr.String(), files)
			}
			after := projectBytes(t, dir)
			for name, text := range before {
				if !slices.Contains(list, name) && after[name] != text {
					t.Errorf("changed the unlisted %s:\n%s", name, after[name])
				}
			}
			noisy := stdmaps.Clone(files)
			for name := range noisy {
				if !slices.Contains(list, name) {
					noisy[name] += "export const broken: string = 1\n"
				}
			}
			other := onlyProject(t, noisy)
			if status, sys := runFix(t, other, "--only", only); status != 0 {
				t.Fatalf("beside errors: status %d, %s", status, sys.stderr.String())
			}
			beside := projectBytes(t, other)
			for _, name := range list {
				if beside[name] != after[name] {
					t.Errorf("%s is\n%s\nbeside unlisted errors, and\n%s\nwithout them", name, beside[name], after[name])
				}
			}
			if status, sys := runFix(t, dir, "--only", only); status != 0 {
				t.Fatalf("second run: status %d, %s", status, sys.stderr.String())
			}
			expectChanged(t, after, projectBytes(t, dir))
		})
	}
}
