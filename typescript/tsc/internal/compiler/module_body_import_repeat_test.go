package compiler_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestModuleBodyImportRepeat(t *testing.T) {
	for _, ext := range []string{"vibe", "vibex"} {
		for _, name := range []string{"platform", "Text", "Ω"} {
			for _, suffix := range []string{".ts", ".js", ""} {
				for _, ref := range []string{"a.d.ts", "z.d.ts"} {
					for _, threaded := range []bool{false, true} {
						key := fmt.Sprintf("%s/%s/%s/%s/threaded=%t", ext, name, suffix, ref, threaded)
						t.Run(key, func(t *testing.T) {
							part := parser.ModuleDeclarationFileSuffix(name)
							stem := "main." + ext + part[:len(part)-len(".ts")]
							files := map[string]any{
								"/src/package.json":  "{\"type\":\"module\"}",
								"/src/tsconfig.json": "{\"compilerOptions\":{\"target\":\"ES2024\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"moduleSuffixes\":[\"\",\".d.vibe\"],\"strict\":true,\"noEmit\":true,\"jsx\":\"preserve\"},\"vibe\":{\"effectGlobals\":false,\"effectModules\":false},\"include\":[\".\"]}",
								"/src/main." + ext:   "module " + name + " { export interface Row { readonly value: 7 }; export function make(): Row { return {value:7} } }\nexport {make} from " + name + "\nexport type {Row} from " + name + "\n",
								"/src/" + ref:        "export declare const stale: import(\"./" + stem + suffix + "\").Row;\n",
							}
							if suffix == "" {
								files["/src/tsconfig.json"] = strings.ReplaceAll(files["/src/tsconfig.json"].(string), "NodeNext", "Preserve")
								files["/src/tsconfig.json"] = strings.Replace(files["/src/tsconfig.json"].(string), "\"moduleResolution\":\"Preserve\"", "\"moduleResolution\":\"Bundler\"", 1)
							}
							for round := range 3 {
								fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
								config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
								if len(ds) != 0 || len(config.Errors) != 0 {
									t.Fatalf("config: %v %v", ds, config.Errors)
								}
								p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil), SingleThreaded: core.BoolToTristate(!threaded)})
								for _, d := range p.GetProgramDiagnostics() {
									t.Errorf("round %d: %s", round, d.String())
								}
								for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
									t.Errorf("round %d: %s", round, d.String())
								}
								if t.Failed() {
									return
								}
								emitted := map[string]string{}
								result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { emitted[name] = text; return nil })
								if result == nil || result.EmitSkipped || len(result.Diagnostics) != 0 {
									t.Fatalf("round %d emit: %+v", round, result)
								}
								for name, text := range emitted {
									files[name] = text
								}
							}
						})
					}
				}
			}
		}
	}
}

func TestModuleBodyImportProtectsWrittenDeclaration(t *testing.T) {
	for _, mode := range []string{"explicit-file", "explicit-import", "unmatched-body", "missing-source"} {
		t.Run(mode, func(t *testing.T) {
			main := "module platform { export interface Row { readonly value: 7 } }\nexport type {Row} from platform\n"
			selection := "\"include\":[\".\"]"
			specifier := "./main.vibe.platform.ts"
			if mode == "explicit-file" {
				selection = "\"files\":[\"main.vibe\",\"ref.d.ts\",\"main.vibe.platform.d.ts\"]"
			}
			if mode == "explicit-import" {
				specifier = "./main.vibe.platform.d.ts"
			}
			if mode == "unmatched-body" {
				main = "export const value = 1\n"
			}
			files := map[string]any{
				"/src/tsconfig.json":           "{\"compilerOptions\":{\"target\":\"ESNext\",\"module\":\"ESNext\",\"moduleResolution\":\"Bundler\",\"noEmit\":true},\"vibe\":{\"effectGlobals\":false,\"effectModules\":false}," + selection + "}",
				"/src/main.vibe":               main,
				"/src/ref.d.ts":                "export declare const row: import(\"" + specifier + "\").Row;\n",
				"/src/main.vibe.platform.d.ts": "export interface Row { readonly value: 7 }\n",
			}
			if mode == "missing-source" {
				delete(files, "/src/main.vibe")
			}
			fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
			config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(ds) != 0 {
				t.Fatal(ds)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			blocked := false
			for _, d := range p.GetProgramDiagnostics() {
				if d.Code() == 5055 {
					blocked = true
				} else {
					t.Error(d.String())
				}
			}
			if want := mode == "explicit-file" || mode == "explicit-import"; blocked != want {
				t.Fatalf("overwrite diagnostic=%t want %t", blocked, want)
			}
			if p.GetSourceFile("/src/main.vibe.platform.d.ts") == nil {
				t.Fatal("written declaration disappeared")
			}
		})
	}
}

func TestModuleBodyImportRespectsNodeNextExtension(t *testing.T) {
	files := map[string]any{
		"/src/package.json":  "{\"type\":\"module\"}",
		"/src/tsconfig.json": "{\"compilerOptions\":{\"target\":\"ESNext\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"noEmit\":true},\"vibe\":{\"effectGlobals\":false,\"effectModules\":false},\"include\":[\".\"]}",
		"/src/main.vibe":     "module platform { export interface Row {value: 7} }\nexport type {Row} from platform\n",
		"/src/ref.d.ts":      "export declare const row: import(\"./main.vibe.platform\").Row;\n",
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
	config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(ds) != 0 {
		t.Fatal(ds)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	rejected := false
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Code() == 2307 || d.Code() == 2834 || d.Code() == 2835 {
			rejected = true
		} else {
			t.Error(d.String())
		}
	}
	if !rejected {
		t.Fatal("NodeNext ESM accepted an extensionless body import")
	}
}

// A .ts or .vibe file that imports a body's tracked declaration output, as a
// Smithers test does through a package's companion, resolves to the body's
// source as TypeScript resolves a .ts file before its .d.ts. Under noEmit the
// companion must not become an input that its own output overwrites (TS5055).
func TestModuleBodyImportFromSourceImporter(t *testing.T) {
	for _, importer := range []string{"use.ts", "use.mts", "use.tsx", "use.vibe"} {
		for _, mode := range []string{"nodenext-cjs", "nodenext-esm", "bundler"} {
			for _, suffix := range []string{".js", ".ts"} {
				for _, tracked := range []bool{true, false} {
					key := fmt.Sprintf("%s/%s/%s/tracked=%t", importer, mode, suffix, tracked)
					t.Run(key, func(t *testing.T) {
						module, resolution := "NodeNext", "NodeNext"
						if mode == "bundler" {
							module, resolution = "ESNext", "Bundler"
						}
						specifier := "./A.vibe.platform" + suffix
						if importer == "use.mts" && suffix == ".js" {
							specifier = "./A.vibe.platform.js"
						}
						files := map[string]any{
							"/src/tsconfig.json":   "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"" + module + "\",\"moduleResolution\":\"" + resolution + "\",\"strict\":true,\"noEmit\":true,\"declaration\":false,\"allowImportingTsExtensions\":true,\"jsx\":\"preserve\",\"types\":[]},\"vibe\":{\"effectGlobals\":false,\"effectModules\":false},\"include\":[\"src/**/*\"]}",
							"/src/src/A.vibe":      "module platform {\n  export const token = (name: string): string => name\n}\n\nexport { token } from platform\n",
							"/src/src/" + importer: "import { token } from \"" + specifier + "\"\nexport const t: string = token(\"x\")\n",
						}
						if mode == "nodenext-esm" {
							files["/src/package.json"] = "{\"type\":\"module\"}"
						}
						if tracked {
							files["/src/src/A.vibe.platform.d.ts"] = "export declare const token: (name: string) => string;\n"
						}
						for round := range 3 {
							fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
							config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
							if len(ds) != 0 || len(config.Errors) != 0 {
								t.Fatalf("config: %v %v", ds, config.Errors)
							}
							p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
							for _, d := range p.GetProgramDiagnostics() {
								t.Errorf("round %d: %s", round, d.String())
							}
							for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
								t.Errorf("round %d: %s", round, d.String())
							}
							if t.Failed() {
								return
							}
							emitted := map[string]string{}
							result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { emitted[name] = text; return nil })
							if result == nil || result.EmitSkipped || len(result.Diagnostics) != 0 {
								t.Fatalf("round %d emit: %+v", round, result)
							}
							for name, text := range emitted {
								files[name] = text
							}
						}
					})
				}
			}
		}
	}
}
