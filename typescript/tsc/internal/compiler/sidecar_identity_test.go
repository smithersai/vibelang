package compiler

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"gotest.tools/v3/assert"
)

// alchemy-36: a workspace package exports a migrated module's sidecar as its
// types, and one of its .ts modules imports the source, ./Stage.vibe. Both
// must be one module to a consumer, as they are to stock TypeScript, which
// reads the sidecar both ways; two files are two Stage classes (TS2345,
// "Types have separate declarations of a private property 'brand'").
func TestPackageSidecarExportIsTheSource(t *testing.T) {
	t.Parallel()
	program := func(t *testing.T, files map[string]any) *Program {
		fs := vfstest.FromMap(files, tspath.CaseSensitive)
		config, diagnostics := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		assert.Equal(t, len(diagnostics), 0)
		return NewProgram(ProgramOptions{Config: config, Host: NewCompilerHost(fs, "/", nil, nil, nil)})
	}
	alchemy := func() map[string]any {
		return map[string]any{
			"/app/package.json":        `{"type":"module"}`,
			"/app/tsconfig.json":       `{"compilerOptions":{"noLib":true,"strict":true,"module":"nodenext","allowArbitraryExtensions":true,"allowImportingTsExtensions":true,"noEmit":true},"files":["src/a.ts"]}`,
			"/app/src/a.ts":            `import { Stage } from "lib/Stage"; import { use } from "lib/Use"; export const run = (s: Stage): string => use(s);`,
			"/app/node_modules/lib":    vfstest.Symlink("/lib"),
			"/lib/package.json":        `{"name":"lib","type":"module","exports":{"./Stage":{"types":"./src/Stage.d.vibe.ts","default":"./src/Stage.vibe"},"./Use":"./src/Use.ts"}}`,
			"/lib/src/Stage.vibe":      `export class Stage { private readonly brand = 1; constructor(readonly name: string) {} }`,
			"/lib/src/Stage.d.vibe.ts": `export declare class Stage { private readonly brand; readonly name: string; constructor(name: string); }`,
			"/lib/src/Use.ts":          `import { Stage } from "./Stage.vibe"; export const use = (s: Stage): string => s.name;`,
		}
	}
	t.Run("a workspace package's sidecar export is its source", func(t *testing.T) {
		t.Parallel()
		p := program(t, alchemy())
		assert.Assert(t, p.GetSourceFile("/lib/src/Stage.vibe") != nil)
		assert.Assert(t, p.GetSourceFile("/lib/src/Stage.d.vibe.ts") == nil, "the sidecar stands in for the source")
		assert.Equal(t, len(p.GetSemanticDiagnostics(t.Context(), nil)), 0)
	})
	// opencode's layer-node: the sidecar re-exports its own source as a
	// namespace, so a consumer meets ReplacementValue through both files
	// unless they are one (TS2741 [ReplacementTypeId] before the fix).
	t.Run("a sidecar that re-exports its source", func(t *testing.T) {
		t.Parallel()
		files := alchemy()
		files["/lib/package.json"] = `{"name":"lib","type":"module","exports":{"./*":{"types":"./src/*.d.vibe.ts","default":"./src/*.vibe"}}}`
		files["/lib/src/layer-node.vibe"] = "export * as LayerNode from \"./layer-node.vibe\"\ndeclare const ReplacementTypeId: unique symbol\nclass ReplacementValue { readonly [ReplacementTypeId] = true }\nexport type Replacement = ReplacementValue\nexport function make(): Replacement { return new ReplacementValue() }\n"
		files["/lib/src/layer-node.d.vibe.ts"] = "export * as LayerNode from \"./layer-node.vibe\";\ndeclare const ReplacementTypeId: unique symbol;\ndeclare class ReplacementValue {\n    readonly [ReplacementTypeId]: true;\n}\nexport type Replacement = ReplacementValue;\nexport declare function make(): Replacement;\n"
		files["/app/src/a.ts"] = "import { type Replacement, LayerNode } from \"lib/layer-node\"\nexport function accept(x: Replacement): void {}\naccept(LayerNode.make())\n"
		p := program(t, files)
		assert.Assert(t, p.GetSourceFile("/lib/src/layer-node.d.vibe.ts") == nil, "the sidecar stands in for the source")
		for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
			t.Error(d.String())
		}
	})
	// t3code batch 08 (SourceControlProvider): lib's Driver.ts reaches
	// Provider through ./Provider.vibe and the app through the package's types
	// export. With two modules, the app's declaration could not name Ctx
	// through its own namespace import: it printed import("lib/Provider").Ctx
	// and dropped the import, a declaration change against the original.
	t.Run("an importer's declaration names the type through its namespace import", func(t *testing.T) {
		t.Parallel()
		fs := vfstest.FromMap(map[string]any{
			"/app/package.json":           `{"type":"module"}`,
			"/app/tsconfig.json":          `{"compilerOptions":{"noLib":true,"strict":true,"module":"nodenext","allowArbitraryExtensions":true,"allowImportingTsExtensions":true,"declaration":true,"emitDeclarationOnly":true},"files":["src/a.ts"]}`,
			"/app/src/a.ts":               "import * as Provider from \"lib/Provider\";\nimport type { Driver } from \"lib/Driver\";\nexport const make = (): Driver => ({ remote: ({ provider }: Provider.Ctx) => provider });\nexport const remoteOf = (d: Driver) => d.remote;\n",
			"/app/node_modules/lib":       vfstest.Symlink("/lib"),
			"/lib/package.json":           `{"name":"lib","type":"module","exports":{"./Provider":{"types":"./src/Provider.d.vibe.ts","default":"./src/Provider.vibe"},"./Driver":"./src/Driver.ts"}}`,
			"/lib/src/Provider.vibe":      `export interface Ctx { readonly provider: string }`,
			"/lib/src/Provider.d.vibe.ts": `export interface Ctx { readonly provider: string; }`,
			"/lib/src/Driver.ts":          `import type * as Provider from "./Provider.vibe"; export interface Driver { readonly remote: (c: Provider.Ctx) => string }`,
		}, tspath.CaseSensitive)
		config, diagnostics := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		assert.Equal(t, len(diagnostics), 0)
		p := NewProgram(ProgramOptions{Config: config, Host: NewCompilerHost(fs, "/", nil, nil, nil)})
		assert.Equal(t, len(p.GetSemanticDiagnostics(t.Context(), nil)), 0)
		var dts string
		result := p.Emit(t.Context(), EmitOptions{WriteFile: func(path tspath.RootedFilePath, text string, _ *WriteFileData) error {
			if path == "/app/src/a.d.ts" {
				dts = text
			}
			return nil
		}})
		assert.Equal(t, len(result.Diagnostics), 0)
		assert.Equal(t, dts, "import * as Provider from \"lib/Provider\";\nimport type { Driver } from \"lib/Driver\";\nexport declare const make: () => Driver;\nexport declare const remoteOf: (d: Driver) => (c: Provider.Ctx) => string;\n")
	})
	t.Run("without its source the sidecar is the module", func(t *testing.T) {
		t.Parallel()
		files := alchemy()
		delete(files, "/lib/src/Stage.vibe")
		files["/lib/src/Use.ts"] = `import { Stage } from "./Stage.d.vibe.ts"; export const use = (s: Stage): string => s.name;`
		p := program(t, files)
		assert.Assert(t, p.GetSourceFile("/lib/src/Stage.d.vibe.ts") != nil)
	})
	for _, test := range []struct{ name, directory, config string }{
		{"conventional mirror", "/lib/.vibe/declarations", "tsconfig.json"},
		{"custom mirror", "/lib/types", "vibe.config.json"},
		{"external mirror", "/declarations/lib", "tsconfig.build.json"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			files := alchemy()
			sidecar := test.directory + "/src/Stage.d.vibe.ts"
			files[sidecar] = files["/lib/src/Stage.d.vibe.ts"]
			delete(files, "/lib/src/Stage.d.vibe.ts")
			files["/lib/"+test.config] = `{"vibe":{"sidecarDir":"` + test.directory + `"}}`
			files["/lib/package.json"] = `{"name":"lib","type":"module","types":"` + sidecar + `","main":"./src/Stage.vibe"}`
			files["/app/src/a.ts"] = `import { Stage } from "lib"; import { use } from "../../lib/src/Use.ts"; export const run = (s: Stage): string => use(s);`
			p := program(t, files)
			assert.Assert(t, p.GetSourceFile("/lib/src/Stage.vibe") != nil)
			assert.Assert(t, p.GetSourceFile(tspath.RootedFilePathFromNormalized(sidecar)) == nil, "a relocated sidecar stands in for its source")
			for _, diagnostic := range p.GetSemanticDiagnostics(t.Context(), nil) {
				t.Error(diagnostic.String())
			}
		})
	}

	t.Run("preserveSymlinks keeps the logical dependency declaration", func(t *testing.T) {
		t.Parallel()
		files := alchemy()
		files["/app/tsconfig.json"] = strings.Replace(files["/app/tsconfig.json"].(string), `"noLib":true`, `"noLib":true,"preserveSymlinks":true`, 1)
		files["/lib/tsconfig.json"] = `{"vibe":{"sidecarDir":".vibe/declarations"}}`
		files["/lib/.vibe/declarations/src/Stage.d.vibe.ts"] = files["/lib/src/Stage.d.vibe.ts"]
		delete(files, "/lib/src/Stage.d.vibe.ts")
		files["/lib/package.json"] = `{"name":"lib","type":"module","exports":{"./Stage":{"types":"./.vibe/declarations/src/Stage.d.vibe.ts"},"./Use":"./src/Use.ts"}}`
		p := program(t, files)
		assert.Assert(t, p.GetSourceFile("/app/node_modules/lib/.vibe/declarations/src/Stage.d.vibe.ts") != nil)
		assert.Assert(t, len(p.GetSemanticDiagnostics(t.Context(), nil)) > 0, "native logical source and declaration identities stay separate (detail 285)")
	})
	t.Run("a published package keeps its declarations", func(t *testing.T) {
		t.Parallel()
		files := alchemy()
		delete(files, "/app/node_modules/lib")
		for _, name := range []string{"package.json", "src/Stage.vibe", "src/Stage.d.vibe.ts", "src/Use.ts"} {
			files["/app/node_modules/lib/"+name] = files["/lib/"+name]
			delete(files, "/lib/"+name)
		}
		p := program(t, files)
		assert.Assert(t, p.GetSourceFile("/app/node_modules/lib/src/Stage.d.vibe.ts") != nil)
	})
}
