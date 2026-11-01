package vibelang

import (
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// TestDeclarationImportsComputedKey checks that a .d.ts which writes a
// computed key the source took from the prelude or effect's root imports the
// key's name, and that a skipLibCheck=false consumer accepts the .d.ts. The
// checker prints such a key by its bare name, [customMatcher], because no
// scope it searches declares the key, and records no import for it.
func TestDeclarationImportsComputedKey(t *testing.T) {
	t.Parallel()
	even := `{ [customMatcher](subject: unknown) { return typeof subject === "number" && subject % 2 === 0 } }`
	for _, test := range []struct {
		name, source      string
		want, avoid, once []string
	}{
		{
			name:   "exported object",
			source: `export const Even = ` + even,
			want:   []string{`import { customMatcher } from "vibelang-runtime";`, `[customMatcher](subject: unknown): boolean;`},
		},
		{
			// The parity harness compares unexported bindings through a type alias.
			name:   "unexported object a type names",
			source: `const Even = ` + even + `; export type Probe = typeof Even`,
			want:   []string{`import { customMatcher } from "vibelang-runtime";`, `[customMatcher](subject: unknown): boolean;`},
		},
		{
			name:   "object inside another",
			source: `const Even = ` + even + `; export const matchers = { Even }`,
			want:   []string{`import { customMatcher } from "vibelang-runtime";`, `[customMatcher](subject: unknown): boolean;`},
		},
		{
			// customMatcher comes from the runtime package, which linked
			// workspaces and the smoke and parity harnesses reach by symlink.
			name:   "symlinked runtime",
			source: `export const Even = ` + even,
			want:   []string{`import { customMatcher } from "vibelang-runtime";`, `[customMatcher](subject: unknown): boolean;`},
		},
		{
			name:   "effect root key",
			source: `export const Shown = { [Inspectable.NodeInspectSymbol]() { return "shown" } }`,
			want:   []string{`import { Inspectable } from "effect";`, `[Inspectable.NodeInspectSymbol](): string;`},
		},
		{
			name:   "beside a well-known symbol key",
			source: `export const Both = { [Symbol.toPrimitive]() { return 1 }, [customMatcher](subject: unknown) { return subject === 2 } }`,
			want:   []string{`import { customMatcher } from "vibelang-runtime";`, `[Symbol.toPrimitive](): number;`, `[customMatcher](subject: unknown): subject is 2;`},
		},
		{
			name:   "class key",
			source: `export class Odd { static [customMatcher](subject: unknown) { return subject === 1 } }`,
			want:   []string{`import { customMatcher } from "vibelang-runtime";`, `static [customMatcher](subject: unknown)`},
		},
		{
			name:   "imported key",
			source: `import { customMatcher } from "vibelang-runtime"; export const Even = ` + even,
			once:   []string{`import { customMatcher } from "vibelang-runtime";`},
		},
		{
			name:   "key the declaration file does not write",
			source: `const Even = ` + even + `; export const n = 1`,
			avoid:  []string{`customMatcher`},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			files := computedKeyFiles(strings.HasPrefix(test.name, "symlinked "))
			files["/workspace/x/src/main.vibe"] = test.source
			dts := emitDeclarations(t, files)
			// A consumer that checks libraries must resolve every name the
			// declaration writes.
			files["/workspace/x/src/main.d.ts"] = dts
			delete(files, "/workspace/x/src/main.vibe")
			files["/workspace/x/src/consumer.ts"] = `import * as value from "./main.js"; export { value }`
			files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"skipLibCheck":false,"module":"NodeNext","noEmit":true},"files":["consumer.ts"]}`
			p := computedKeyProgram(t, files)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("declaration consumer: %s\n%s", d.String(), dts)
				}
			}
			for _, want := range test.want {
				if !strings.Contains(dts, want) {
					t.Fatalf("declaration lacks %q:\n%s", want, dts)
				}
			}
			for _, avoid := range test.avoid {
				if strings.Contains(dts, avoid) {
					t.Fatalf("declaration has %q:\n%s", avoid, dts)
				}
			}
			for _, once := range test.once {
				if n := strings.Count(dts, once); n != 1 {
					t.Fatalf("declaration has %q %d times, want once:\n%s", once, n, dts)
				}
			}
		})
	}
}

// computedKeyFiles is a package with effect and vibelang-runtime installed, or
// linked from outside every ancestor node_modules when symlinked is true.
func computedKeyFiles(symlinked bool) map[string]string {
	effect := "/workspace/x/src/node_modules/effect/"
	runtime := "/workspace/x/src/node_modules/vibelang-runtime/"
	if symlinked {
		effect = "/external/experiments/node_modules/effect/"
		runtime = "/external/runtime/"
	}
	return map[string]string{
		"/workspace/x/src/package.json":  `{"type":"module"}`,
		"/workspace/x/src/tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true},"files":["main.vibe"]}`,
		effect + "package.json":      `{"name":"effect","type":"module","exports":{".":{"types":"./index.d.ts"},"./Effect":{"types":"./Effect.d.ts"},"./Inspectable":{"types":"./Inspectable.d.ts"}}}`,
		effect + "index.d.ts":        `export * as Effect from "./Effect.js"; export * as Inspectable from "./Inspectable.js"`,
		effect + "Effect.d.ts":       `export interface Effect<A, E = never, R = never> { readonly "~effect/Effect": { readonly _A: (_: never) => A; readonly _E: (_: never) => E; readonly _R: (_: never) => R } }`,
		effect + "Inspectable.d.ts":  `export declare const NodeInspectSymbol: unique symbol`,
		runtime + "package.json":     `{"name":"vibelang-runtime","type":"module","exports":{".":{"types":"./index.d.ts"}}}`,
		runtime + "index.d.ts":       `export * as Effect from "effect/Effect"; export * from "./match.js"`,
		runtime + "match.d.ts":       `export declare const customMatcher: unique symbol`,
	}
}

// computedKeyProgram builds the program of /workspace/x/src/tsconfig.json, linking
// the packages into node_modules when they live outside it.
func computedKeyProgram(t *testing.T, files map[string]string) *compiler.Program {
	t.Helper()
	entries := make(map[string]any, len(files)+3)
	for name, text := range files {
		entries[name] = text
	}
	if _, linked := files["/external/runtime/index.d.ts"]; linked {
		entries["/workspace/x/src/node_modules/effect"] = vfstest.Symlink("/external/experiments/node_modules/effect")
		entries["/workspace/x/src/node_modules/vibelang-runtime"] = vfstest.Symlink("/external/runtime")
		entries["/external/runtime/node_modules/effect"] = vfstest.Symlink("/external/experiments/node_modules/effect")
	}
	var fs vfs.FS = bundled.WrapFS(vfstest.FromMap(entries, tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/workspace/x/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
}

// emitDeclarations returns the main.d.ts that the program of files emits,
// failing on any error diagnostic.
func emitDeclarations(t *testing.T, files map[string]string) string {
	t.Helper()
	p := computedKeyProgram(t, files)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("source: %s", d.String())
		}
	}
	var dts string
	result := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(string(name), "main.d.ts") {
			dts = text
		}
		return nil
	}})
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("emit: %s", d.String())
		}
	}
	if dts == "" {
		t.Fatal("no main.d.ts emitted")
	}
	return dts
}

// S19-1: copied annotations must import prelude names even when nodebuilder
// reuses the syntax without its entity-visibility callback. A fresh TypeScript
// consumer checks scope resolution with declaration checking enabled.
func TestDeclarationImportsRecycledAnnotation(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, source, want string
		prelude            bool
	}{
		{"arrow", `export const value = effect (): Effect.Effect<number, never, never> => { return 42 }`, `Effect.Effect<number, never, never>`, true},
		{"function expression", `export const value = effect function(): Effect.Effect<number, never, never> { return 42 }`, `Effect.Effect<number, never, never>`, true},
		{"object method", `export const value = { effect run(): Effect.Effect<number, never, never> { return 42 } }`, `Effect.Effect<number, never, never>`, true},
		{"explicit import", `import { Effect as E } from "effect"; export const value = effect (): E.Effect<number, never, never> => { return 42 }`, `import { Effect as E } from "effect";`, false},
		{"generic shadow", `export const value = <Effect>(x: Effect): Effect => x`, `<Effect>(x: Effect) => Effect`, false},
		{"namespace shadow", `namespace Effect { export type Effect<A, E, R> = A }; export const value = (): Effect.Effect<number, never, never> => 42`, `Effect.Effect<number, never, never>`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = test.source
			dts := emitDeclarations(t, files)
			if !strings.Contains(dts, test.want) {
				t.Fatalf("declaration lacks %q:\n%s", test.want, dts)
			}
			if got := strings.Contains(dts, `import { Effect } from "effect";`); got != test.prelude {
				t.Fatalf("prelude import = %v, want %v:\n%s", got, test.prelude, dts)
			}
			files["/workspace/x/src/main.d.ts"] = dts
			delete(files, "/workspace/x/src/main.vibe")
			files["/workspace/x/src/consumer.ts"] = `import * as value from "./main.js"; export { value }`
			files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"skipLibCheck":false,"module":"NodeNext","noEmit":true},"files":["consumer.ts"]}`
			p := computedKeyProgram(t, files)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("declaration consumer: %s\n%s", d.String(), dts)
				}
			}
		})
	}
}

func TestDeclarationElidesPrivateJSDoc(t *testing.T) {
	for _, test := range []struct {
		name, source string
		want, avoid  []string
	}{
		{"elided namespace import", "/** PRIVATE_DOC */\nimport type * as E from \"effect/Effect\"\n/** PUBLIC_DOC */\nexport const visible = 2", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"strip internal", "/** @internal PRIVATE_DOC */\nexport const hidden = 1\n/** PUBLIC_DOC */\nexport const visible = 2", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"private Effect function", "/** PRIVATE_DOC */\neffect function hidden(): number!! { return 1 }\n/** PUBLIC_DOC */\nexport effect function visible(): number!! { return 2 }", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"overload implementation", "function hidden(x: number): number;\n/** PRIVATE_DOC */\nfunction hidden(x: number): number { return x }\n/** PUBLIC_DOC */\nexport const visible = 2", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"namespace private", "export namespace Public {\n/** PRIVATE_DOC */\nconst hidden = 1\n/** PUBLIC_DOC */\nexport const visible = 2\n}", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"prelude import", "/** PRIVATE_DOC */\nconst hidden = 1\n/** PUBLIC_DOC */\nexport declare const visible: Effect.Effect<number, never, never>", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"private function with prelude import", "/** PRIVATE_DOC */\nfunction hidden(): number { return 1 }\n/** PUBLIC_DOC */\nexport declare const visible: Effect.Effect<number, never, never>", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"elided import", "/** PRIVATE_DOC */\nimport type { Effect } from \"effect/Effect\"\n/** PUBLIC_DOC */\nexport const visible = 2", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"private class", "/** PRIVATE_DOC */\nclass Hidden { n = 1 }\n/** PUBLIC_DOC */\nexport const visible = 2", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		// Stock TypeScript retains detached file headers, even above an elided declaration.
		{"detached header above private", "/** HEADER_DOC */\n\nconst hidden = 1\n/** PUBLIC_DOC */\nexport const visible = 2", []string{"HEADER_DOC", "PUBLIC_DOC"}, nil},
		{"private first", "/** PRIVATE_DOC */\nconst hidden = 1\n/** PUBLIC_DOC */\nexport const visible = 2", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"private between exports", "export const first = 1\n/** PRIVATE_DOC */\nfunction hidden(): number { return 1 }\n/** PUBLIC_DOC */\nexport const visible = 2", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"private last", "export const first = 1\n/** PRIVATE_DOC */\nconst hidden = 2", nil, []string{"PRIVATE_DOC"}},
		{"private type", "/** PRIVATE_DOC */\ntype Hidden = string\n/** PUBLIC_DOC */\nexport interface Visible { n: number }", []string{"PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
		{"retained private dependency", "/** RETAINED_DOC */\nclass Hidden { value = 1 }\n/** PUBLIC_DOC */\nexport const visible = new Hidden()", []string{"RETAINED_DOC", "PUBLIC_DOC"}, nil},
		{"detached header", "/** LICENSE_DOC */\n\n/** PRIVATE_DOC */\nconst hidden = 1\n/** PUBLIC_DOC */\nexport const visible = 2", []string{"LICENSE_DOC", "PUBLIC_DOC"}, []string{"PRIVATE_DOC"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = test.source
			if test.name == "strip internal" {
				files["/workspace/x/src/tsconfig.json"] = strings.Replace(files["/workspace/x/src/tsconfig.json"], `"declaration":true`, `"declaration":true,"stripInternal":true`, 1)
			}
			dts := emitDeclarations(t, files)
			for _, want := range test.want {
				if !strings.Contains(dts, want) {
					t.Errorf("missing %s: %s", want, dts)
				}
			}
			for _, avoid := range test.avoid {
				if strings.Contains(dts, avoid) {
					t.Errorf("orphan %s: %s", avoid, dts)
				}
			}
		})
	}
}

// The declaration transforms of a program's files run in parallel and record
// prelude references in the checker's maps; each transform reads a copy taken
// under the checker's lock, so a project of many files neither races nor
// stops with "concurrent map read and map write". Only the race detector
// sees the race reliably, so smoke.sh runs this test with -race.
func TestDeclarationEmitInParallel(t *testing.T) {
	t.Parallel()
	files := computedKeyFiles(false)
	config := "" // the tsconfig.json of computedKeyFiles' package, in its directory
	for name := range files {
		if strings.HasSuffix(name, "/tsconfig.json") {
			config = name
		}
	}
	src := strings.TrimSuffix(config, "tsconfig.json")
	var names []string
	for i := range 16 {
		name := fmt.Sprintf("m%d.vibe", i)
		names = append(names, `"`+name+`"`)
		files[src+name] = fmt.Sprintf("export type T%d = Effect<number, never, never>\nexport function f%d(): Effect<number> { return %d }\n", i, i, i)
	}
	files[config] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true},"files":[` + strings.Join(names, ",") + `]}`
	for range 4 {
		p := computedKeyProgram(t, files)
		var declarations atomic.Int32 // the emitters of a program write in parallel
		result := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
			if strings.HasSuffix(string(name), ".d.ts") {
				declarations.Add(1)
				if !strings.Contains(text, "Effect.Effect<number, never, never>") {
					t.Errorf("%s writes the prelude's Effect unqualified:\n%s", name, text)
				}
			}
			return nil
		}})
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("emit: %s", d.String())
			}
		}
		if n := declarations.Load(); n != 16 {
			t.Fatalf("emitted %d declaration files, want 16", n)
		}
	}
}
