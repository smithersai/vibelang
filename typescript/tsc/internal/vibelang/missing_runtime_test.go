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
		// VIP-1: an effect function without catch or producers lowers to
		// effect/Effect alone, so it needs no runtime.
		{"effect", "export effect function value() { return 1 }", "", false, nil},
		{"producer", "export effect function* value() { yield 1 }", "", false, []int32{2307}},
		{"catch", `export effect function value() { return Effect.fail("bad") catch (_e) => 0 }`, "", false, []int32{2307}},
		{"destructured catch", `export effect function value() { return Effect.fail({ message: "bad" }) catch ({ message }) => message.length }`, "", false, []int32{2307}},
		{"rest catch", `export effect function value() { return Effect.fail("bad") catch (...errors) => errors.length }`, "", false, []int32{2307}},
		{"multiple files", "import './other.js'\nexport effect function value() { return 1 }", "export effect function* values() { yield 1 }", false, []int32{2307}},
		{"independent error", "export error Missing { id: string }\nexport const x: number = 'bad'", "", false, []int32{2307, 2322}},
		{"independent callback parameter", `export effect function value() { return Effect.fail(0) catch (_e) => { const inner = (x): number => 1; return inner(0) } }`, "", false, []int32{2307, 7006}},
		{"independent nested call callback", `export effect function value() { return Effect.fail(0) catch (_e) => { const invoke = (cb: any): number => cb(0); return invoke((x): number => 1) } }`, "", false, []int32{2307, 7006}},
		{"written import", "import { Experimental as Existing } from \"vibelang-runtime\"\nexport effect function value() { return 1 }", "", false, []int32{2307}},
		{"late written import", "export const before = 1\nimport { Experimental as Existing } from \"vibelang-runtime\"\nexport effect function value() { return 1 }", "", false, []int32{2307}},
		{"multiple written imports", "import { Experimental as Existing } from \"vibelang-runtime\"\nimport \"./other.js\"\nexport effect function value() { return 1 }", "import { Experimental as Existing } from \"vibelang-runtime\"\nexport effect function other() { return 1 }", false, []int32{2307}},
		{"written subpath import", "import * as Existing from \"vibelang-runtime/experimental\"\nexport effect function value() { return 1 }", "", false, []int32{2307}},
		{"independent missing package", "import { absent } from \"missing-other-package\"\nexport error Missing { id: string }", "", false, []int32{2307, 2307}},
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
		{"Effect", "export error Missing { id: string }\nexport effect function value() { return Effect }", "{\"effectModules\":false}", true},
		{"Stream", "export error Missing { id: string }\nexport effect function value() { return Stream }", "{\"effectModules\":false}", true},
		{"function global", "export error Missing { id: string }\nexport effect function value() { return succeed }", "{\"effectGlobals\":false}", true},
		{"intrinsic shorthand", "export error Missing { id: string }\nexport effect function value(): number!! { return 1 }", "{\"effectModules\":false}", false},
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

// Chapter 7's dependency diagnostic is project-wide, including written native
// imports, while independent TypeScript errors retain their own diagnostics.
func TestMissingRuntimeForeignImports(t *testing.T) {
	for _, installed := range []bool{false, true} {
		for _, independent := range []bool{false, true} {
			for _, reverse := range []bool{false, true} {
				for _, foreignFirst := range []bool{false, true} {
					t.Run(fmt.Sprintf("installed=%t/independent=%t/reverse=%t/foreignFirst=%t", installed, independent, reverse, foreignFirst), func(t *testing.T) {
						packages := map[string]string{"effect": "packages/runtime/node_modules/effect"}
						if installed {
							packages["vibelang-runtime"] = "packages/runtime"
						}
						_, file, _, _ := editorProgramWith(t, "import './other.js'\nexport effect function value() { return 1 }", packages)
						dir := filepath.Dir(file.FileName().AsString())
						other := "import * as Existing from 'vibelang-runtime'\nexport const value = Existing\n"
						if independent {
							other += "export const wrong: number = 'bad'\n"
						}
						if err := os.WriteFile(filepath.Join(dir, "other.ts"), []byte(other), 0600); err != nil {
							t.Fatal(err)
						}
						names := "[\"main.vibe\",\"other.ts\"]"
						if reverse {
							names = "[\"other.ts\",\"main.vibe\"]"
						}
						configName := filepath.Join(dir, "tsconfig.json")
						configText := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":" + names + "}"
						if err := os.WriteFile(configName, []byte(configText), 0600); err != nil {
							t.Fatal(err)
						}
						var disk vfs.FS = osvfs.FS()
						if !installed {
							disk = missingRuntimeTestFS{disk}
						}
						fs := bundled.WrapFS(disk)
						config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
						if len(errors) != 0 {
							t.Fatal(errors)
						}
						program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
						if foreignFirst {
							for _, source := range program.GetSourceFiles() {
								if strings.HasSuffix(source.FileName().AsString(), "/other.ts") {
									program.GetSemanticDiagnostics(t.Context(), source)
								}
							}
						}
						for repeat := 0; repeat < 2; repeat++ {
							got := map[int32]int{}
							for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
								if d.Category() == diagnostics.CategoryError {
									got[d.Code()]++
								}
							}
							want := map[int32]int{}
							if !installed {
								want[2307] = 1
							}
							if independent {
								want[2322] = 1
							}
							if !stdmaps.Equal(got, want) {
								t.Fatalf("want %v, got %v: %v", want, got, program.GetSemanticDiagnostics(t.Context(), nil))
							}
						}
					})
				}
			}
		}
	}
}

// A project with only native inputs retains TypeScript's ordinary per-import
// diagnostics; there is no compiler-generated VibeLang dependency to replace.
func TestMissingRuntimeNativeOnly(t *testing.T) {
	_, file, _, _ := editorProgramWith(t, "export const unused = 1", nil)
	dir := filepath.Dir(file.FileName().AsString())
	source := "import * as Existing from 'vibelang-runtime'\nexport const value = Existing\n"
	for _, name := range []string{"a.ts", "b.ts"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(source), 0600); err != nil {
			t.Fatal(err)
		}
	}
	configName := filepath.Join(dir, "tsconfig.json")
	text := "{\"compilerOptions\":{\"module\":\"NodeNext\",\"target\":\"ES2022\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":[\"a.ts\",\"b.ts\"]}"
	if err := os.WriteFile(configName, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(missingRuntimeTestFS{osvfs.FS()})
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	all := program.GetSemanticDiagnostics(t.Context(), nil)
	if len(all) != 2 || all[0].Code() != 2307 || all[1].Code() != 2307 {
		t.Fatalf("want two native missing-import diagnostics, got %v", all)
	}
}

// fixtureRuntime keeps dependency-free trust/contract tests focused on their
// rule while letting the compiler resolve the runtime's namespace.
func fixtureRuntime(files map[string]string) map[string]string {
	files["/node_modules/vibelang-runtime/package.json"] = "{\"name\":\"vibelang-runtime\",\"types\":\"index.d.ts\"}"
	files["/node_modules/vibelang-runtime/index.d.ts"] = "export declare const Experimental: any"
	return files
}
