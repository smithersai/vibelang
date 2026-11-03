package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPreludeRootFunctionImports(t *testing.T) {
	for _, name := range []string{"pipe", "flow", "identity", "absurd", "cast", "hole"} {
		for _, form := range []string{"value", "alias", "type"} {
			for _, installed := range []bool{false, true} {
				label := name + "/" + form + "/absent"
				if installed {
					label = name + "/" + form + "/installed"
				}
				t.Run(label, func(t *testing.T) {
					source := "export const value=" + name
					if form == "alias" {
						source = "const selected=" + name + ";export const value=selected"
					}
					if form == "type" {
						source = "export type Fn=typeof " + name
					}
					p := rootFunctionProgram(t, source, installed)
					for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
						if d.Category() == diagnostics.CategoryError {
							t.Fatalf("native root function needs unrelated runtime: %s", d.String())
						}
					}
					text := rootFunctionJavaScript(t, p)
					if strings.Contains(text, "vibelang-runtime") {
						t.Fatalf("native root function imports unrelated runtime: %s", text)
					}
					if form != "type" && !strings.Contains(text, "effect/Function") {
						t.Fatalf("native root function lacks direct Function import: %s", text)
					}
				})
			}
		}
	}
	for _, source := range []string{
		"const pipe=7;export const value=pipe",
		"import {pipe as selected} from 'effect/Function';export const value=selected",
	} {
		t.Run(source, func(t *testing.T) {
			p := rootFunctionProgram(t, source, false)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatal(d.String())
				}
			}
			if text := rootFunctionJavaScript(t, p); strings.Contains(text, "vibelang-runtime") {
				t.Fatalf("control needs runtime: %s", text)
			}
		})
	}
}
func rootFunctionProgram(t *testing.T, source string, installed bool) *compiler.Program {
	t.Helper()
	packages := map[string]string{"effect": "packages/runtime/node_modules/effect"}
	if installed {
		packages["vibelang-runtime"] = "packages/runtime"
	}
	_, file, _, _ := editorProgramWith(t, source, packages)
	path := filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json")
	if err := os.WriteFile(path, []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"outDir":"out"},"files":["main.vibe"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(path)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	return compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
}
func rootFunctionJavaScript(t *testing.T, p *compiler.Program) string {
	t.Helper()
	var js string
	p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), "/main.js") {
			js = text
		}
		return nil
	}})
	if js == "" {
		t.Fatal("no JavaScript emitted")
	}
	return js
}

// A namespace imported under a function's spelling is the whole module.
// Automatic import cleanup must not replace it with the bare function.
func TestPreludeRootFunctionNamespaceRepair(t *testing.T) {
	for _, name := range []string{"pipe", "flow", "identity"} {
		t.Run(name, func(t *testing.T) {
			source := "import * as " + name + " from 'effect/Function'; const selected=" + name + ".identity; export const result=typeof selected"
			p := rootFunctionProgram(t, source, true)
			var path string
			for _, file := range p.GetSourceFiles() {
				if strings.HasSuffix(file.FileName().AsString(), "/main.vibe") {
					path = filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json")
					break
				}
			}
			if path == "" {
				t.Fatal("missing source project")
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(path)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 || len(config.Errors) != 0 {
				t.Fatalf("config: %v %v", errors, config.Errors)
			}
			result := FixProject(t.Context(), fs, bundled.LibPath(), config)
			if len(result.Order) != 0 || len(result.Refused) != 0 {
				t.Fatalf("namespace import was treated as the bare function: changed=%v refused=%+v", result.Order, result.Refused)
			}
		})
	}
}
