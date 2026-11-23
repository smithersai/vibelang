package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func BenchmarkBangTypes(b *testing.B) {
	inputs := []string{
		"function find(id: string): Effect<string, NotFound, never>",
		`import("effect/Effect", { with: { "resolution-mode": "import" } }).Effect<string, A | B, never>`,
		"Effect<Effect<A | B, E1 & E2, R1>, E2 | E3, R2 | R3>",
		"Map<string, ReadonlyArray<Effect<{ a: number; b: string }, ErrA | ErrB, Db | Cache>>>",
		"const f: (x: number) => Effect<() => void, never, never>",
	}
	totalBytes := 0
	for _, s := range inputs {
		totalBytes += len(s)
	}
	b.SetBytes(int64(totalBytes))
	b.ReportAllocs()
	for b.Loop() {
		for _, in := range inputs {
			if out := bangTypes(in); len(out) == 0 {
				b.Fatal("empty output")
			}
		}
	}
}

func makeInMemoryVibeProject(modules int) map[string]string {
	files := map[string]string{}
	fileNames := make([]string, 0, modules)
	for i := range modules {
		name := fmt.Sprintf("m%d.vibe", i)
		fileNames = append(fileNames, fmt.Sprintf("%q", name))
		var imp, call string
		if i > 0 {
			imp = fmt.Sprintf("import { compute%d } from \"./m%d.vibe\"\n", i-1, i-1)
			call = fmt.Sprintf("compute%d(x)", i-1)
		} else {
			call = "x + 1"
		}
		files["/src/"+name] = fmt.Sprintf(`%sexport error Invalid%d { code: number }
export interface Row%d { id: string; count: number }
export function plain%d(x: number): number { return x * 2 + %d }
export function compute%d(x: number): number {
  const prev = %s
  return match (prev) {
    when 0: 1;
    when let n: n + plain%d(x);
  }
}
`, imp, i, i, i, i, i, call, i)
	}
	files["/src/tsconfig.json"] = fmt.Sprintf(
		`{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","moduleResolution":"NodeNext","declaration":true,"outDir":"dist","rewriteRelativeImportExtensions":true,"skipLibCheck":true,"types":[]},"files":[%s]}`,
		strings.Join(fileNames, ","),
	)
	files = fixtureRuntime(files)
	files["/node_modules/effect/package.json"] = `{"name":"effect","types":"index.d.ts"}`
	files["/node_modules/effect/index.d.ts"] = "export declare const Data: any; export declare const Effect: any; export declare const Schema: any; export declare const Context: any; export declare const Layer: any;"
	files["/node_modules/vibelang-runtime/index.d.ts"] = strings.Join([]string{
		"export declare const Experimental: any;",
		"export declare const $is: any;",
		"export declare const $extract: any;",
		"export declare const $rest: any;",
		"export declare const $noMatch: any;",
		"export declare const $matchCache: any;",
		"export declare const $registerErrorMatcher: any;",
		"export declare const $schemaErrorMatcher: any;",
		"export declare const $schemaErrorFamily: any;",
		"export declare const $schemaErrorMember: any;",
		"export declare const $errorSubclass: any;",
		"export declare const TaggedError: any;",
		"export declare const Schema: any;",
	}, "\n")
	return files
}

func BenchmarkVibeLangCheckAndEmit(b *testing.B) {
	for _, size := range []struct {
		name    string
		modules int
	}{
		{"CheckEmit_1mod", 1},
		{"CheckEmit_10mod", 10},
	} {
		files := makeInMemoryVibeProject(size.modules)
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
		config, errs := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errs) != 0 {
			b.Fatalf("%s: config errors: %v", size.name, errs)
		}
		// Verify cleanly once before timing.
		checkProg := compiler.NewProgram(compiler.ProgramOptions{
			Config: config,
			Host:   compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil),
		})
		if diags := checkProg.GetSemanticDiagnostics(b.Context(), nil); len(diags) != 0 {
			b.Fatalf("%s: semantic diagnostic: %v", size.name, diags[0].String())
		}

		b.Run(size.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				p := compiler.NewProgram(compiler.ProgramOptions{
					Config: config,
					Host:   compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil),
				})
				_ = p.GetSemanticDiagnostics(b.Context(), nil)
				emitted := 0
				res := p.Emit(b.Context(), compiler.EmitOptions{
					WriteFile: func(_ tspath.RootedFilePath, _ string, _ *compiler.WriteFileData) error {
						emitted++
						return nil
					},
				})
				if emitted == 0 || len(res.Diagnostics) != 0 {
					b.Fatalf("emit failed: emitted=%d diags=%v", emitted, res.Diagnostics)
				}
			}
		})
	}
}
