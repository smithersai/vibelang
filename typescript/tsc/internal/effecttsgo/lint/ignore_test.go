package lint

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// lintFixture is foldkit's layout for `vibelang lint -c .oxlintrc.effect.json
// --deny-warnings .`: a repository root (`.git`), its `.gitignore` with `dist`,
// a package whose build copies linted sources into `dist/templates`, and the
// other ignore sources Oxlint 1.85.0 reads for the same invocation.
func lintFixture(t *testing.T) (dir string, write func(name, text string)) {
	t.Helper()
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = "../../../../../experiments/node_modules"
	}
	effect, err := filepath.Abs(filepath.Join(modules, "effect"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(effect, "package.json")); err != nil {
		t.Skipf("effect is not installed: %v", err)
	}
	dir = t.TempDir()
	write = func(name, text string) {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(dir, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(effect, filepath.Join(dir, "node_modules", "effect")); err != nil {
		t.Fatal(err)
	}
	write("package.json", `{"private":true,"type":"module"}`)
	write("tsconfig.json", `{"compilerOptions":{"target":"es2022","module":"nodenext","moduleResolution":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"include":["src","repos"]}`)
	write(".oxlintrc.effect.json", `{ "rules": { "effecttsgo/effect-sleep-zero-to-yield-now": "error" }, "ignorePatterns": ["packages/create-foldkit-app/templates/"] }`)
	write(".git/info/exclude", "excluded/\n")
	write(".gitignore", "node_modules\ndist\ncoverage\n# comment\n*.gen.vibe\n!keep.gen.vibe\n/root-only.vibe\n")
	write(".ignore", "repos/\n")
	write(".eslintignore", "scripts/legacy/\n")
	write("custom.ignore", "scripts/custom/\n")
	write("packages/nested/.gitignore", "generated/\n")
	sleep := "import { Effect } from \"effect\"\n\nexport function pause() {\n  Effect.sleep(0)\n  return 1\n}\n"
	plain := "export const value = 1\n"
	write("src/main.vibe", sleep)
	write("src/keep.gen.vibe", plain)
	write("src/skip.gen.vibe", plain)
	write("src/root-only.vibe", plain)
	write("root-only.vibe", plain)
	write("repos/r.vibe", plain)
	write("packages/create-foldkit-app/dist/templates/example/main.vibe", plain)
	write("packages/create-foldkit-app/templates/example/main.vibe", plain)
	write("packages/nested/generated/g.vibe", plain)
	write("coverage/c.vibe", plain)
	write("excluded/e.vibe", plain)
	write("scripts/legacy/l.vibe", plain)
	write("scripts/custom/c.vibe", plain)
	write("tmp/t.vibe", plain)
	return dir, write
}

func runLint(t *testing.T, dir string, args ...string) (status int, out, errOut string) {
	t.Helper()
	sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
	status = Command(context.Background(), sys, append([]string{"-c", ".oxlintrc.effect.json", "--deny-warnings"}, args...))
	return status, sys.out.String(), sys.err.String()
}

// unlinted lists the files the command reported as not linted.
func unlinted(errOut string) []string {
	var files []string
	for line := range strings.SplitSeq(errOut, "\n") {
		if rest, ok := strings.CutPrefix(line, "vibelang lint: "); ok && strings.Contains(rest, "not linted") {
			files = append(files, filepath.ToSlash(strings.SplitN(rest, ":", 2)[0]))
		}
	}
	return files
}

func expectUnlinted(t *testing.T, label, errOut string, want ...string) {
	t.Helper()
	if got := unlinted(errOut); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("%s: not linted %v, want %v\n%s", label, got, want, errOut)
	}
}

// TestCommandHonorsOxlintIgnoreSources: `vibelang lint` walks the files Oxlint
// walks (foldkit-75). foldkit's build copies linted sources into
// `packages/create-foldkit-app/dist/templates`; Oxlint skips them through the
// repository's `.gitignore`, and so must the lint command, along with
// `.git/info/exclude`, nested `.gitignore` files, negations, the
// configuration's ignorePatterns, `.eslintignore`, `--ignore-path` and
// `--ignore-pattern`; `--no-ignore` turns off the last three but never the
// gitignore sources, and `.ignore` files are not read (Oxlint 1.85.0,
// configure_walk_builder: `.ignore(false)`, `.git_ignore(true)`,
// `.git_exclude(true)`, `.parents(true)`).
func TestCommandHonorsOxlintIgnoreSources(t *testing.T) {
	dir, _ := lintFixture(t)

	status, out, errOut := runLint(t, dir, ".")
	if status != 1 || !strings.Contains(out, "src/main.vibe(4,3): error EK3833:") {
		t.Fatalf("status %d, want 1 with main.vibe's error\n%s%s", status, out, errOut)
	}
	// src/main.vibe, src/keep.gen.vibe (re-included), src/root-only.vibe (the
	// anchored pattern ignores only the root file) and repos/r.vibe (`.ignore` is not read).
	if !strings.Contains(out, "1 error(s) and 0 warning(s) in 4 .vibe file(s).") {
		t.Errorf("summary:\n%s", out)
	}
	// Only the files no ignore source covers are reported as unchecked.
	expectUnlinted(t, "default", errOut, "scripts/custom/c.vibe", "tmp/t.vibe")
	for _, file := range []string{"dist/templates", "generated/g.vibe", "coverage/c.vibe", "excluded/e.vibe", "scripts/legacy", "skip.gen.vibe", "create-foldkit-app/templates"} {
		if strings.Contains(out+errOut, file) {
			t.Errorf("%s is ignored by Oxlint but was walked:\n%s%s", file, out, errOut)
		}
	}

	// --ignore-path replaces .eslintignore; --ignore-pattern adds a glob; both spellings of a value work.
	_, out, errOut = runLint(t, dir, "--ignore-path", "custom.ignore", "--ignore-pattern=tmp/**", ".")
	expectUnlinted(t, "--ignore-path --ignore-pattern", errOut, "scripts/legacy/l.vibe")
	if !strings.Contains(out, "in 4 .vibe file(s).") {
		t.Errorf("summary with flags:\n%s", out)
	}

	// --no-ignore drops the ignore file and the patterns, not the gitignore sources.
	_, out, errOut = runLint(t, dir, "--no-ignore", "--ignore-pattern", "tmp/**", ".")
	expectUnlinted(t, "--no-ignore", errOut, "scripts/custom/c.vibe", "scripts/legacy/l.vibe", "tmp/t.vibe")
	if strings.Contains(out+errOut, "dist/templates") || strings.Contains(out+errOut, "excluded/e.vibe") {
		t.Errorf("--no-ignore must keep .gitignore and info/exclude:\n%s%s", out, errOut)
	}

	// An ignored file named on the command line is skipped too, as Oxlint's walk-root check does.
	status, out, errOut = runLint(t, dir, "packages/create-foldkit-app/dist/templates/example/main.vibe", "src/main.vibe")
	if status != 1 || !strings.Contains(out, "in 1 .vibe file(s).") || len(unlinted(errOut)) != 0 {
		t.Errorf("explicit ignored file: status %d\n%s%s", status, out, errOut)
	}

	// Without a repository boundary, parent directories' .gitignore files still apply (require_git false).
	if err := os.RemoveAll(filepath.Join(dir, ".git")); err != nil {
		t.Fatal(err)
	}
	_, out, errOut = runLint(t, dir, ".")
	if strings.Contains(out+errOut, "dist/templates") {
		t.Errorf("without .git the .gitignore must still apply:\n%s%s", out, errOut)
	}
	expectUnlinted(t, "no .git", errOut, "excluded/e.vibe", "scripts/custom/c.vibe", "tmp/t.vibe")
}

// TestCommandIgnoresGeneratedOutputAcrossPaths ports drive-foldkit-ui's
// native-lint-coverage property (seed 53132, 30 runs): build output under
// `dist/templates` at nested and Unicode paths is skipped, while a native
// source outside its project is still reported.
func TestCommandIgnoresGeneratedOutputAcrossPaths(t *testing.T) {
	dir, write := lintFixture(t)
	segments := []string{"native", "a b", "é", "部件", "nested", "0"}
	random := rand.New(rand.NewSource(53132))
	for run := 0; run < 30; run++ {
		parts := []string{"packages", "create-foldkit-app", "dist", "templates"}
		for n := random.Intn(5); n > 0; n-- {
			parts = append(parts, segments[random.Intn(len(segments))])
		}
		output := filepath.Join(append(parts, "main.vibe")...)
		write(output, fmt.Sprintf("export const generated = %d\n", run))
		status, out, errOut := runLint(t, dir, "--ignore-pattern", "tmp/**", "--ignore-path", "custom.ignore", "src", "packages")
		if status != 1 || !strings.Contains(out, "in 3 .vibe file(s).") || len(unlinted(errOut)) != 0 {
			t.Fatalf("run %d, %s: status %d\n%s%s", run, output, status, out, errOut)
		}
	}
	write("unlisted/live.vibe", "export const live = 1\n")
	_, _, errOut := runLint(t, dir, "unlisted")
	expectUnlinted(t, "unprojected source", errOut, "unlisted/live.vibe")
}

func TestParseIgnoreMatchesGitignoreSyntax(t *testing.T) {
	list := parseIgnore("/r", "# comment\n\ndist\n*.gen.vibe  \n!keep.gen.vibe\n/root.vibe\ndocs/\n\\#literal\nbuild/[ab]*\n")
	cases := []struct {
		path    string
		isDir   bool
		decided bool
		ignored bool
	}{
		{"/r/dist", true, true, true},
		{"/r/pkg/dist/x.vibe", false, true, true},
		{"/r/pkg/dist", false, true, true},
		{"/r/a.gen.vibe", false, true, true},
		{"/r/pkg/keep.gen.vibe", false, true, false},
		{"/r/root.vibe", false, true, true},
		{"/r/pkg/root.vibe", false, false, false},
		{"/r/docs", true, true, true},
		{"/r/docs", false, false, false},
		{"/r/docs/x.vibe", false, true, true},
		{"/r/#literal", false, true, true},
		{"/r/build/a1.vibe", false, true, true},
		{"/r/build/c1.vibe", false, false, false},
		{"/other/dist", true, false, false},
	}
	for _, c := range cases {
		decided, ignored := list.match(c.path, c.isDir)
		if decided != c.decided || ignored != c.ignored {
			t.Errorf("%s (dir %v): decided %v ignored %v, want %v %v", c.path, c.isDir, decided, ignored, c.decided, c.ignored)
		}
	}
}
