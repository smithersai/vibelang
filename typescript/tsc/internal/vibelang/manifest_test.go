package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestPackageEmitHasNoManifest(t *testing.T) {
	for _, options := range []string{`"outDir":"dist"`, `"outDir":"dist","declarationDir":"types"`, `"emitDeclarationOnly":true,"outDir":"dist"`, `"outDir":"dist","declarationMap":true`} {
		t.Run(options, func(t *testing.T) {
			fs := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(map[string]string{
				"/src/index.vibe":    `export function double(n: number): number { return n * 2 }`,
				"/src/tsconfig.json": `{"compilerOptions":{"declaration":true,` + options + `},"files":["index.vibe"]}`,
			}), tspath.CaseSensitive))
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			count := 0
			result := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
				count++
				if name.BaseName() == "vibelang.manifest.json" {
					t.Errorf("unexpected package output %s", name)
				}
				return nil
			}})
			if count == 0 || len(result.Diagnostics) != 0 {
				t.Fatalf("emit: %d outputs, %v", count, result.Diagnostics)
			}
		})
	}
}

// VIP-36: "What an import may throw now travels in its declaration file,
// the same for VibeLang and hand-written TypeScript."
func TestStaleManifestDoesNotChangeDeclarationCalls(t *testing.T) {
	for _, extension := range []string{"vibe", "ts"} {
		for _, contract := range []string{"never", "unknown", ""} {
			t.Run(extension+"/"+contract, func(t *testing.T) {
				var baseline []string
				for i, manifest := range []string{"", `{"declarations":["index.d.ts"]}`, `{"declarations":[]}`, `not json`} {
					tag := ""
					if contract != "" {
						tag = "/** @throws {" + contract + "} */\n"
					}
					source := `import { double } from "./lib/index.js"; export function plain() { return double(1) }`
					if extension == "vibe" {
						source += `; export effect function run() { return double(2) }`
					}
					files := manifestFixture(map[string]string{
						"/app/main." + extension: source,
						"/app/lib/index.d.ts":    tag + `export declare function double(n: number): number;`,
						"/app/tsconfig.json":     fmt.Sprintf(`{"compilerOptions":{"strict":true,"noEmit":true},"files":["main.%s"]}`, extension),
					})
					if manifest != "" {
						files["/app/lib/vibelang.manifest.json"] = manifest
					}
					fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
					config, errors := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
					if len(errors) != 0 {
						t.Fatal(errors)
					}
					p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
					var diagnostics []string
					for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile(tspath.RootedFilePath("/app/main."+extension))) {
						diagnostics = append(diagnostics, fmt.Sprintf("%d:%d:%s", d.Code(), d.Pos(), d.String()))
					}
					want := 0
					if extension == "vibe" && contract != "never" {
						want = 1 // Unknown defaults are diagnosed at the unwrapped effect call.
						if contract == "unknown" {
							want = 2
						} // An explicit throwing contract also rejects the plain call.
						if len(diagnostics) == 2 && (!strings.HasPrefix(diagnostics[0], "401:") || !strings.HasPrefix(diagnostics[1], "403:")) {
							t.Errorf("lost diagnostic ownership: %v", diagnostics)
						}
					}
					if len(diagnostics) != want {
						t.Errorf("contract %q: got %v, want %d diagnostics", contract, diagnostics, want)
					}
					if i == 0 {
						baseline = diagnostics
					} else if !slices.Equal(baseline, diagnostics) {
						t.Errorf("manifest %q changes diagnostics: absent=%v present=%v", manifest, baseline, diagnostics)
					}
					t.Logf("contract=%q manifest=%q diagnostics=%v", contract, manifest, diagnostics)
				}
			})
		}
	}
}

// VIP-36 removes out-of-band certification. A built package's consumer
// follows its actual declaration contract, including VIP-4's unknown default.
// The tagged foreign export is a positive control for VIP-27 metadata;
// declaration normalization of locally defined plain functions has its own owner.
func TestBuiltPackageDeclarationConsumers(t *testing.T) {
	for _, producer := range []string{"local", "tagged-foreign-export"} {
		t.Run(producer, func(t *testing.T) {
			source := `export function double(n: number): number { return n * 2 }`
			if producer == "tagged-foreign-export" {
				source = `export { double } from "./helper.js"`
			}
			fs := bundled.WrapFS(vfstest.FromMap(manifestFixture(map[string]string{
				"/producer/index.vibe":    source,
				"/producer/helper.ts":     "/** @throws {never} */\nexport function double(n: number): number { return n * 2 }",
				"/producer/tsconfig.json": `{"compilerOptions":{"declaration":true,"outDir":"dist","module":"nodenext","moduleResolution":"nodenext"},"files":["index.vibe","helper.ts"]}`,
			}), tspath.CaseSensitive))
			config, errs := tsoptions.GetParsedCommandLineOfConfigFile("/producer/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errs) != 0 {
				t.Fatal(errs)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil), SingleThreaded: core.TSTrue})
			declarations := map[string]string{}
			emitted := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
				if strings.HasSuffix(name.AsString(), ".d.ts") {
					declarations[strings.TrimPrefix(name.AsString(), "/producer/dist/")] = text
				}
				return nil
			}})
			if len(emitted.Diagnostics) != 0 {
				t.Fatal(emitted.Diagnostics)
			}
			if declarations["index.d.ts"] == "" {
				t.Fatal("producer emitted no declaration")
			}
			for _, extension := range []string{"ts", "vibe"} {
				t.Run(extension, func(t *testing.T) {
					var baseline []string
					for i, manifest := range []string{"", `{"declarations":["index.d.ts","helper.d.ts"]}`} {
						source := `import { double } from "./lib/index.js"; export function plain() { return double(1) }`
						if extension == "vibe" {
							source += `; export effect function run() { return double(2) }`
						}
						files := manifestFixture(map[string]string{
							"/app/main." + extension: source,
							"/app/tsconfig.json":     fmt.Sprintf(`{"compilerOptions":{"strict":true,"noEmit":true},"files":["main.%s"]}`, extension),
						})
						for name, text := range declarations {
							files["/app/lib/"+name] = text
						}
						if manifest != "" {
							files["/app/lib/vibelang.manifest.json"] = manifest
						}
						fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
						config, errs := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
						if len(errs) != 0 {
							t.Fatal(errs)
						}
						p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
						var diagnostics []string
						for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile(tspath.RootedFilePath("/app/main."+extension))) {
							diagnostics = append(diagnostics, fmt.Sprintf("%d:%d:%s", d.Code(), d.Pos(), d.String()))
						}
						if (extension == "ts" || producer == "tagged-foreign-export") && len(diagnostics) != 0 {
							t.Errorf("consumer of %v: %v", declarations, diagnostics)
						}
						if i == 0 {
							baseline = diagnostics
						} else if !slices.Equal(baseline, diagnostics) {
							t.Errorf("stale manifest changed built-package diagnostics: absent=%v present=%v", baseline, diagnostics)
						}
						t.Logf("producer=%s client=%s manifest=%q declarations=%v diagnostics=%v", producer, extension, manifest, declarations, diagnostics)
					}
				})
			}
		})
	}
}

func manifestFixture(files map[string]string) map[string]string {
	files["/node_modules/effect/package.json"] = `{"name":"effect","types":"index.d.ts","exports":{".":{"types":"./index.d.ts"},"./Effect":{"types":"./dist/Effect.d.ts"}}}`
	files["/node_modules/effect/index.d.ts"] = `export * as Effect from "./dist/Effect.js"`
	files["/node_modules/effect/dist/Effect.d.ts"] = `export interface Effect<A, E = never, R = never> { readonly "~effect/Effect": { readonly _A: (_: never) => A; readonly _E: (_: never) => E; readonly _R: (_: never) => R } }`
	return fixtureRuntime(files)
}
