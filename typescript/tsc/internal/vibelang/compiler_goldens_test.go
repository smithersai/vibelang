package vibelang

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// TestCompilerGoldenCases brings the native acceptance corpus's diagnostic
// spans and emitted JS/declaration contracts into go test's coverage. The
// external smoke harness remains responsible for running their programs.
// This uses the real compiler pipeline and pinned packages, not stub Effect
// types or a subprocess invisible to the coverage profiler (D24, D31, D34).
func TestCompilerGoldenCases(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	cases := filepath.Join(root, "typescript/vibelang/cases")
	dirs, err := os.ReadDir(cases)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, entry := range dirs {
		if !entry.IsDir() {
			continue
		}
		fixture := filepath.Join(cases, entry.Name())
		goldens, err := filepath.Glob(filepath.Join(fixture, "expected", "*"))
		if err != nil {
			t.Fatal(err)
		}
		goldens = slices.DeleteFunc(goldens, func(name string) bool {
			return filepath.Base(name) != "diagnostics.txt" && !strings.HasSuffix(name, ".js") && !strings.HasSuffix(name, ".d.ts")
		})
		if len(goldens) == 0 {
			continue
		}
		count++
		t.Run(entry.Name(), func(t *testing.T) {
			if pending, err := os.ReadFile(filepath.Join(fixture, "pending")); err == nil {
				t.Skipf("existing acceptance gap: %s", pending)
			}
			dir := copyCompilerFixture(t, fixture, root)
			fileSystem := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fileSystem, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fileSystem, bundled.LibPath(), nil, nil, nil)})
			all := compiler.SortAndDeduplicateDiagnostics(commandLineDiagnostics(t, config.Errors, program))
			wantDiagnostics, hasDiagnosticGolden := "", false
			needsEmit := false
			for _, golden := range goldens {
				if filepath.Base(golden) == "diagnostics.txt" {
					text, err := os.ReadFile(golden)
					if err != nil {
						t.Fatal(err)
					}
					wantDiagnostics, hasDiagnosticGolden = strings.TrimSpace(string(text)), true
				} else {
					needsEmit = true
				}
			}
			if hasDiagnosticGolden {
				var lines []string
				for _, d := range all {
					lines = append(lines, compilerDiagnosticLine(t, dir, d))
				}
				if got := strings.Join(lines, "\n"); got != wantDiagnostics {
					t.Fatalf("diagnostic golden differs:\ngot:\n%s\nwant:\n%s", got, wantDiagnostics)
				}
			} else {
				for _, d := range all {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("unexpected error: %s", d.String())
					}
				}
			}
			if !needsEmit {
				return
			}
			outputs := map[string]string{}
			var outputMutex sync.Mutex
			result := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
				rel, err := filepath.Rel(filepath.Join(dir, "out"), string(name))
				if err != nil {
					return err
				}
				outputMutex.Lock()
				outputs[filepath.ToSlash(rel)] = text
				outputMutex.Unlock()
				return nil
			}})
			if result.EmitSkipped {
				t.Fatal("emit was skipped")
			}
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("emit error: %s", d.String())
				}
			}
			for _, golden := range goldens {
				if filepath.Base(golden) == "diagnostics.txt" {
					continue
				}
				want, err := os.ReadFile(golden)
				if err != nil {
					t.Fatal(err)
				}
				if got, ok := outputs[filepath.Base(golden)]; !ok || got != string(want) {
					t.Errorf("%s differs:\ngot:\n%s\nwant:\n%s", filepath.Base(golden), got, want)
				}
			}
		})
	}
	if count == 0 {
		t.Fatal("no compiler goldens discovered")
	}
	t.Logf("checked %d native compiler golden cases", count)
}

func copyCompilerFixture(t *testing.T, fixture, root string) string {
	t.Helper()
	// Unnamed fixture packages derive their nominal service key from the
	// directory name, so preserve it instead of using TempDir's "001".
	temp := t.TempDir()
	// Preserve the acceptance corpus's inherited ESM package scope. Individual
	// fixtures can override it with their own package.json.
	if err := os.WriteFile(filepath.Join(temp, "package.json"), []byte(`{"type":"module"}`), 0600); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(temp, filepath.Base(fixture))
	err := filepath.WalkDir(fixture, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(fixture, name)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if rel != "." && (rel == "node_modules" || entry.Name() == "out" || entry.Name() == "expected" || strings.HasPrefix(entry.Name(), ".")) {
				return filepath.SkipDir
			}
			return os.MkdirAll(filepath.Join(dir, rel), 0755)
		}
		// Nested node_modules links are part of package-layout fixtures.
		// Preserve their relative targets instead of copying their contents.
		if entry.Type()&fs.ModeSymlink != 0 {
			target, err := os.Readlink(name)
			if err != nil {
				return err
			}
			return os.Symlink(target, filepath.Join(dir, rel))
		}
		data, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dir, rel), data, 0600)
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	// Copy the runtime's published files, as the smoke harness does. Linking
	// its checkout would resolve optional peers through its development
	// node_modules instead of the fixture's. The runtime has only peers.
	runtime := filepath.Join(root, "packages/runtime")
	manifest, err := os.ReadFile(filepath.Join(runtime, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct {
		Files []string `json:"files"`
	}
	if err := json.Unmarshal(manifest, &pkg); err != nil {
		t.Fatal(err)
	}
	installed := filepath.Join(dir, "node_modules/vibelang-runtime")
	if err := os.MkdirAll(installed, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range append([]string{"package.json"}, pkg.Files...) {
		source, target := filepath.Join(runtime, name), filepath.Join(installed, name)
		info, err := os.Stat(source)
		if os.IsNotExist(err) {
			continue // npm also omits missing files, such as an optional LICENSE.
		}
		if err != nil {
			t.Fatal(err)
		}
		if info.IsDir() {
			if err := os.CopyFS(target, os.DirFS(source)); err != nil {
				t.Fatal(err)
			}
		} else {
			data, err := os.ReadFile(source)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(target, data, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	// Both the fixture and its installed runtime resolve the same Effect.
	if err := os.Symlink(filepath.Join(runtime, "node_modules/effect"), filepath.Join(dir, "node_modules/effect")); err != nil {
		t.Fatal(err)
	}
	// A directory under the fixture's stubs/ with a package.json stands in
	// for the package it names, as the smoke harness links it.
	stubs, _ := os.ReadDir(filepath.Join(dir, "stubs"))
	for _, stub := range stubs {
		manifest, err := os.ReadFile(filepath.Join(dir, "stubs", stub.Name(), "package.json"))
		if err != nil {
			continue
		}
		var pkg struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(manifest, &pkg); err != nil || pkg.Name == "" {
			t.Fatalf("stubs/%s/package.json names no package: %v", stub.Name(), err)
		}
		at := filepath.Join(dir, "node_modules", filepath.FromSlash(pkg.Name))
		if err := os.MkdirAll(filepath.Dir(at), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join(dir, "stubs", stub.Name()), at); err != nil {
			t.Fatal(err)
		}
	}
	// Link only real dependencies that this fixture explicitly declares,
	// after stubs so a package-layout fixture can substitute its own package.
	if manifest, err := os.ReadFile(filepath.Join(dir, "package.json")); err == nil {
		var pkg struct {
			Dependencies map[string]string `json:"dependencies"`
		}
		if err := json.Unmarshal(manifest, &pkg); err != nil {
			t.Fatal(err)
		}
		for name := range pkg.Dependencies {
			at := filepath.Join(dir, "node_modules", filepath.FromSlash(name))
			if _, err := os.Stat(at); err == nil {
				continue
			}
			var target string
			for _, modules := range []string{os.Getenv("EFFECT_NODE_MODULES"), filepath.Join(runtime, "node_modules")} {
				if modules == "" {
					continue
				}
				candidate := filepath.Join(modules, filepath.FromSlash(name))
				if _, err := os.Stat(candidate); err == nil {
					target = candidate
					break
				}
			}
			if target == "" {
				t.Fatalf("fixture dependency %s is missing from EFFECT_NODE_MODULES and packages/runtime/node_modules", name)
			}
			if err := os.MkdirAll(filepath.Dir(at), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(target, at); err != nil {
				t.Fatal(err)
			}
		}
	}
	return dir
}

// commandLineDiagnostics returns the diagnostics `vibelang -p` reports for
// program: its semantic diagnostics only when it has no syntax errors.
func commandLineDiagnostics(t *testing.T, configErrors []*ast.Diagnostic, program *compiler.Program) []*ast.Diagnostic {
	t.Helper()
	all := slices.Concat(configErrors, program.GetConfigFileParsingDiagnostics())
	syntactic := program.GetSyntacticDiagnostics(t.Context(), nil)
	all = append(all, syntactic...)
	if len(syntactic) == 0 {
		all = append(all, program.GetGlobalDiagnostics(t.Context())...)
		all = append(all, program.GetSemanticDiagnostics(t.Context(), nil)...)
		// What a sidecar cannot print, which vibelang reports from its emit.
		all = append(all, program.EmitDeclarationSidecars(t.Context(), func(string, string) error { return nil })...)
	}
	return all
}

func compilerDiagnosticLine(t *testing.T, dir string, d *ast.Diagnostic) string {
	t.Helper()
	source := d.Source()
	if source == "" {
		source = "TS"
	}
	code := fmt.Sprintf("%s%d", source, d.Code())
	if source == "EK" {
		code = fmt.Sprintf("EK%04d", d.Code())
	}
	message := fmt.Sprintf("%s %s", d.Category().Name(), code)
	if d.File() == nil {
		return message
	}
	// A module declaration's body (D283) reports at its .vibe file's positions.
	origin := d.File()
	if canonical := origin.CanonicalSourceFile(); canonical != nil {
		origin = canonical
	}
	file, err := filepath.Rel(dir, string(origin.FileName()))
	if err != nil {
		t.Fatal(err)
	}
	line, column := scanner.GetECMALineAndUTF16CharacterOfPosition(origin, d.Pos())
	return fmt.Sprintf("%s(%d,%d): %s", filepath.ToSlash(file), line+1, column+1, message)
}

// The compiler fixtures must see the runtime as an installed package. A
// symlink to its checkout would expose private development dependencies and
// resolve optional peers there instead of in the fixture's node_modules.
func TestCompilerFixtureRuntimeIsolation(t *testing.T) {
	root := t.TempDir()
	fixture := filepath.Join(root, "fixture")
	runtime := filepath.Join(root, "packages/runtime")
	for name, text := range map[string]string{
		filepath.Join(fixture, "tsconfig.json"):                                  "{}",
		filepath.Join(runtime, "package.json"):                                   `{"name":"vibelang-runtime","files":["dist"]}`,
		filepath.Join(runtime, "dist/index.d.ts"):                                "export declare const installed: true",
		filepath.Join(runtime, "node_modules/@effect/platform-bun/package.json"): `{"name":"@effect/platform-bun"}`,
	} {
		if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	dir := copyCompilerFixture(t, fixture, root)
	installed := filepath.Join(dir, "node_modules/vibelang-runtime")
	if _, err := os.Stat(filepath.Join(installed, "dist/index.d.ts")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(installed, "node_modules/@effect/platform-bun")); !os.IsNotExist(err) {
		t.Fatalf("runtime development dependency leaked into fixture: %v", err)
	}
}
