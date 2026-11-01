package compiler

import (
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
	t.Run("without its source the sidecar is the module", func(t *testing.T) {
		t.Parallel()
		files := alchemy()
		delete(files, "/lib/src/Stage.vibe")
		files["/lib/src/Use.ts"] = `import { Stage } from "./Stage.d.vibe.ts"; export const use = (s: Stage): string => s.name;`
		p := program(t, files)
		assert.Assert(t, p.GetSourceFile("/lib/src/Stage.d.vibe.ts") != nil)
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
