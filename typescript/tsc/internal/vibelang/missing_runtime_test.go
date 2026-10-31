package vibelang

import (
	"fmt"
	stdmaps "maps"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestMissingRuntimeDependency(t *testing.T) {
	for _, tc := range []struct {
		name, source, other string
		installed           bool
		codes               []int32
	}{
		{"plain constant", "export const value = 1", "", false, nil},
		{"plain function", "export function value(): number { return 1 }", "", false, nil},
		{"runtime value", "export const value = Experimental", "", false, []int32{2307}},
		{"error declaration", "export error Missing { id: string }", "", false, []int32{2307}},
		{"effect", "export effect function value() { return 1 }", "", false, []int32{2307}},
		{"producer", "export effect function* value() { yield 1 }", "", false, []int32{2307}},
		{"catch", `export effect function value() { return Effect.fail("bad") catch (_e) => 0 }`, "", false, []int32{2307}},
		{"destructured catch", `export effect function value() { return Effect.fail({ message: "bad" }) catch ({ message }) => message.length }`, "", false, []int32{2307}},
		{"rest catch", `export effect function value() { return Effect.fail("bad") catch (...errors) => errors.length }`, "", false, []int32{2307}},
		{"multiple files", "import './other.js'\nexport effect function value() { return 1 }", "export effect function* values() { yield 1 }", false, []int32{2307}},
		{"independent error", "export effect function value() { return 1 }\nexport const x: number = 'bad'", "", false, []int32{2307, 2322}},
		{"independent callback parameter", `export effect function value() { return Effect.fail(0) catch (_e) => { const inner = (x): number => 1; return inner(0) } }`, "", false, []int32{2307, 7006}},
		{"independent nested call callback", `export effect function value() { return Effect.fail(0) catch (_e) => { const invoke = (cb: any): number => cb(0); return invoke((x): number => 1) } }`, "", false, []int32{2307, 7006}},
		{"written import", "import { Experimental as Existing } from \"vibelang-runtime\"\nexport effect function value() { return 1 }", "", false, []int32{2307}},
		{"late written import", "export const before = 1\nimport { Experimental as Existing } from \"vibelang-runtime\"\nexport effect function value() { return 1 }", "", false, []int32{2307}},
		{"multiple written imports", "import { Experimental as Existing } from \"vibelang-runtime\"\nimport \"./other.js\"\nexport effect function value() { return 1 }", "import { Experimental as Existing } from \"vibelang-runtime\"\nexport effect function other() { return 1 }", false, []int32{2307}},
		{"written subpath import", "import * as Existing from \"vibelang-runtime/experimental\"\nexport effect function value() { return 1 }", "", false, []int32{2307}},
		{"independent missing package", "import { absent } from \"missing-other-package\"\nexport effect function value() { return 1 }", "", false, []int32{2307, 2307}},
		{"subpath only imports", "import * as Existing from \"vibelang-runtime/experimental\"\nimport \"./other.js\"\nexport const value = Existing", "import * as Other from \"vibelang-runtime/experimental\"\nexport const other = Other", false, []int32{2307}},
		{"installed subpath only", "import * as Existing from \"vibelang-runtime/experimental\"\nexport const value = Existing", "", true, nil},
		{"installed subpath", "import * as Existing from \"vibelang-runtime/experimental\"\nexport effect function value() { return 1 }", "", true, nil},
		{"installed", `export effect function value() { return Effect.fail("bad") catch (_e) => 0 }`, "", true, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			packages := map[string]string{"effect": "packages/runtime/node_modules/effect"}
			if tc.installed {
				packages["vibelang-runtime"] = "packages/runtime"
			}
			program, file, _, _ := editorProgramWith(t, tc.source, packages)
			dir := filepath.Dir(file.FileName().AsString())
			if tc.other != "" {
				if err := os.WriteFile(filepath.Join(dir, "other.vibe"), []byte(tc.other), 0600); err != nil {
					t.Fatal(err)
				}
			}
			{
				var disk vfs.FS = osvfs.FS()
				if !tc.installed {
					disk = missingRuntimeTestFS{disk}
				}
				fs := bundled.WrapFS(disk)
				config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
				if len(errors) != 0 {
					t.Fatal(errors)
				}
				program = compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			}
			for _, d := range program.GetSuggestionDiagnostics(t.Context(), nil) {
				if d.Code() == 2307 {
					t.Fatalf("dependency leaked into suggestions: %s", d.String())
				}
			}
			for repeat := 0; repeat < 2; repeat++ {
				all := program.GetSemanticDiagnostics(t.Context(), nil)
				counts := map[int32]int{}
				var printed []string
				var summary []string
				for _, d := range all {
					summary = append(summary, fmt.Sprintf("%s%d[%v]: %s", d.Source(), d.Code(), d.Category(), diagnosticWithNotes(d)))
					if d.Category() != diagnostics.CategoryError {
						t.Logf("independent non-error diagnostic: %s", summary[len(summary)-1])
						continue
					}
					counts[d.Code()]++
					printed = append(printed, diagnosticWithNotes(d))
					if d.Code() == 2307 && (strings.Contains(d.String(), "$") || (!strings.Contains(d.String(), runtimeModule) && tc.name != "independent missing package")) {
						t.Fatalf("dependency message: %s", d.String())
					}
				}
				if len(printed) != len(tc.codes) {
					t.Fatalf("diagnostics=%v; want error codes=%v", summary, tc.codes)
				}
				wantCounts := map[int32]int{}
				for _, code := range tc.codes {
					wantCounts[code]++
				}
				for code, want := range wantCounts {
					if counts[code] != want {
						t.Fatalf("diagnostics=%v; want %d occurrences of %d", printed, want, code)
					}
				}
			}
		})
	}
}

// Keep the deliberately absent dependency absent even when the checkout or
// TMPDIR lives beneath an unrelated project that installs the runtime.
type missingRuntimeTestFS struct{ vfs.FS }

func runtimeTestPath(name string) bool {
	return strings.Contains(name, "/node_modules/vibelang-runtime/") || strings.HasSuffix(name, "/node_modules/vibelang-runtime")
}
func (fs missingRuntimeTestFS) FileExists(name tspath.RootedFilePath) bool {
	return !runtimeTestPath(name.AsString()) && fs.FS.FileExists(name)
}
func (fs missingRuntimeTestFS) ReadFile(name tspath.RootedFilePath) (string, bool) {
	if runtimeTestPath(name.AsString()) {
		return "", false
	}
	return fs.FS.ReadFile(name)
}
func (fs missingRuntimeTestFS) DirectoryExists(name tspath.RootedDirectoryPath) bool {
	return !runtimeTestPath(name.AsString()) && fs.FS.DirectoryExists(name)
}

// VIP-14 switches disable source namespaces, while parser support remains.
// Their TS errors are independent of the separate missing runtime dependency.
func TestMissingRuntimeDisabledModuleNames(t *testing.T) {
	for _, test := range []struct {
		name, source, settings string
		missing                bool
	}{
		{"Effect", "export effect function value() { return Effect }", "{\"effectModules\":false}", true},
		{"Stream", "export effect function value() { return Stream }", "{\"effectModules\":false}", true},
		{"function global", "export effect function value() { return succeed }", "{\"effectGlobals\":false}", true},
		{"intrinsic shorthand", "export effect function value(): number!! { return 1 }", "{\"effectModules\":false}", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, file, _, _ := editorProgramWith(t, test.source, map[string]string{"effect": "packages/runtime/node_modules/effect"})
			dir := filepath.Dir(file.FileName().AsString())
			configName := filepath.Join(dir, "tsconfig.json")
			text := fmt.Sprintf("{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"vibe\":%s,\"files\":[\"main.vibe\"]}", test.settings)
			if err := os.WriteFile(configName, []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(missingRuntimeTestFS{osvfs.FS()})
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			counts := map[int32]int{}
			for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				counts[d.Code()]++
				if d.Code() == 2304 && strings.Contains(diagnosticWithNotes(d), "Install") {
					t.Fatalf("disabled name got package-install advice: %s", diagnosticWithNotes(d))
				}
			}
			want := map[int32]int{2307: 1}
			if test.missing {
				want[2304] = 1
			}
			if !stdmaps.Equal(counts, want) {
				t.Fatalf("want %v, got %v", want, counts)
			}
		})
	}
}

// fixtureRuntime keeps dependency-free trust/contract tests focused on their
// rule while letting the compiler resolve the runtime's namespace.
func fixtureRuntime(files map[string]string) map[string]string {
	files["/node_modules/vibelang-runtime/package.json"] = "{\"name\":\"vibelang-runtime\",\"types\":\"index.d.ts\"}"
	files["/node_modules/vibelang-runtime/index.d.ts"] = "export declare const Experimental: any"
	return files
}
