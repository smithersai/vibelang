package vibelang

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// A refusal is loud (spec ruling, 2026-11-01): foldkit-18's shape compiled
// with only the warning EK4802 and returned a program. When --fix-vip-only
// refuses a call, it names the site, fails, and makes EK4802 an error in
// the project's config with a comment that says why, so each refused site
// fails to compile until it is migrated by hand; the owner removes the
// setting when a run refuses none. A second run does not write it twice.
func TestFixVIPRefusalFailsAndMakesEK4802AnError(t *testing.T) {
	source := legacyRunsPrelude + "effect function f() {\n  return [1].map((n) => {\n    load(n)\n    return n\n  })\n}\n"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	sys := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
	if status := FixWithOptions(t.Context(), sys, []string{"-p", dir}, FixOptions{VIPOnly: true}); status != FixStatusRefused {
		t.Fatalf("status %d, want FixStatusRefused; stdout:\n%s\nstderr:\n%s", status, sys.stdout.String(), sys.stderr.String())
	}
	line := strings.Count(source[:strings.Index(source, "load(n)")], "\n") + 1
	if want := "main.vibe:" + strconv.Itoa(line) + ": try not written: "; !strings.Contains(sys.stdout.String(), want) {
		t.Errorf("stdout names no refused site %q:\n%s", want, sys.stdout.String())
	}
	if !strings.Contains(sys.stdout.String(), "tsconfig.json: EK4802 is now an error: ") {
		t.Errorf("stdout says nothing of the setting:\n%s", sys.stdout.String())
	}
	config, err := os.ReadFile(filepath.Join(dir, "tsconfig.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(config), `"EK4802": "error"`) || !strings.Contains(string(config), "// vibelang --fix-vip-only refused 1 call that may have run before VIP-1") {
		t.Fatalf("tsconfig.json:\n%s", config)
	}

	// The refused site fails to compile.
	errorsAt := refusedLineErrors(t, dir, line)
	if len(errorsAt) == 0 {
		t.Fatalf("the refused site at line %d compiles without an error", line)
	}

	again := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
	if status := FixWithOptions(t.Context(), again, []string{"-p", dir}, FixOptions{VIPOnly: true}); status != FixStatusRefused {
		t.Fatalf("second run status %d", status)
	}
	second, _ := os.ReadFile(filepath.Join(dir, "tsconfig.json"))
	if string(second) != string(config) || strings.Contains(again.stdout.String(), "EK4802 is now an error") {
		t.Errorf("a second run changed the config:\n%s", second)
	}

	// Ordinary --fix neither fails nor writes the setting.
	_, plainFile, _, _ := editorProgram(t, source)
	plainDir := filepath.Dir(plainFile.FileName().AsString())
	plain := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: plainDir}
	if status := FixWithOptions(t.Context(), plain, []string{"-p", plainDir}, FixOptions{}); status != 0 {
		t.Fatalf("ordinary --fix status %d", status)
	}
	if text, _ := os.ReadFile(filepath.Join(plainDir, "tsconfig.json")); strings.Contains(string(text), "EK4802") {
		t.Errorf("ordinary --fix wrote the setting:\n%s", text)
	}
}

// refusedLineErrors compiles the project in dir and returns the errors of
// main.vibe on line.
func refusedLineErrors(t *testing.T, dir string, line int) []string {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	file := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe"))))
	var found []string
	for _, d := range append(program.GetSemanticDiagnostics(t.Context(), file), program.GetSyntacticDiagnostics(t.Context(), file)...) {
		if d.Category() != diagnostics.CategoryError || d.File() != file {
			continue
		}
		if l, _ := scanner.GetECMALineAndUTF16CharacterOfPosition(file, d.Pos()); l+1 == line {
			found = append(found, strconv.Itoa(int(d.Code()))+": "+d.String())
		}
	}
	return found
}

// SetVibeSeverity adds the entry under whatever of vibe and severities the
// config has, keeps its comments, and changes nothing that already says it.
func TestSetVibeSeverity(t *testing.T) {
	name := tspath.RootedFilePathFromAbsolute("/p/tsconfig.json")
	for _, c := range []struct{ in, want string }{
		{"{\n  // keep\n  \"compilerOptions\": {}\n}\n", "{\n  // why\n  \"vibe\": {\"severities\": {\"EK4802\": \"error\"}},\n  // keep\n  \"compilerOptions\": {}\n}\n"},
		{"{\"vibe\": {}}", "{\"vibe\": {\n  // why\n  \"severities\": {\"EK4802\": \"error\"}}}"},
		{"{\"vibe\": {\"severities\": {\"EK4801\": \"off\"}}}", "{\"vibe\": {\"severities\": {\n  // why\n  \"EK4802\": \"error\",\"EK4801\": \"off\"}}}"},
		{"{\"vibe\": {\"severities\": {\"EK4802\": \"off\"}}}", "{\"vibe\": {\"severities\": {// why\n\"EK4802\": \"error\"}}}"},
	} {
		got, changed := tsoptions.SetVibeSeverity(name, c.in, "EK4802", "error", "why")
		if !changed || got != c.want {
			t.Errorf("SetVibeSeverity(%q) = %q, %v; want %q", c.in, got, changed, c.want)
		}
		if _, again := tsoptions.SetVibeSeverity(name, got, "EK4802", "error", "why"); again {
			t.Errorf("a second SetVibeSeverity changed %q", got)
		}
	}
	if _, changed := tsoptions.SetVibeSeverity(name, "{\"vibe\": 1}", "EK4802", "error", "why"); changed {
		t.Error("SetVibeSeverity wrote into a vibe that is not an object")
	}
}

// The setting a refusal writes turns EK4802 into an error, which Appendix B
// lists as a configurable warning: a refused site that returns its program
// unrun no longer compiles.
func TestEK4802SeverityError(t *testing.T) {
	source := legacyRunsPrelude + "effect function f() {\n  return load(1)\n}\n"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	config := `{"vibe": {"severities": {"EK4802": "error"}}, "compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	line := strings.Count(source[:strings.Index(source, "return load(1)")], "\n") + 1
	found := refusedLineErrors(t, dir, line)
	if len(found) != 1 || !strings.HasPrefix(found[0], "4802: ") {
		t.Fatalf("errors on line %d: %v; want EK4802 as an error", line, found)
	}
}
