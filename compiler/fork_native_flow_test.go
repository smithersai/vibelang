package compiler

import (
	"sort"
	"strings"
	"testing"
)

type nativeFlowForkCase struct {
	name     string
	main     string
	modules  []SourceFile
	wantPins []string
	accept   bool
}

func runNativeFlowForkCases(t *testing.T, cases []nativeFlowForkCase) {
	t.Helper()
	backend, ctx := newPinnedTestBackend(t)
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: testCase.main}}
			files = append(files, testCase.modules...)
			roots := make([]string, 0, len(files))
			for _, file := range files {
				if file.Kind == FileKindSmithers || file.Kind == FileKindSmithersJSX {
					roots = append(roots, file.Path)
				}
			}
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: roots,
				Files:     files,
				Options:   Options{},
				Lowering:  LoweringInternal,
			})
			if err != nil {
				t.Fatal(err)
			}
			pins := make([]string, 0)
			for _, diagnostic := range result.Diagnostics {
				if diagnostic.Code == "SMITHERS3001" {
					pins = append(pins, diagnostic.Message)
				}
			}
			sort.Strings(pins)
			want := append([]string(nil), testCase.wantPins...)
			sort.Strings(want)
			if strings.Join(pins, "\n") != strings.Join(want, "\n") {
				t.Fatalf("native-pin messages\n got: %q\nwant: %q\nall diagnostics: %#v", pins, want, result.Diagnostics)
			}
			if testCase.accept {
				if errors := formatDiagnosticPositions(t, files, result); len(errors) != 0 {
					t.Fatalf("the deliberate acceptance boundary was rejected: %v (%#v)", errors, result.Diagnostics)
				}
				if got := runEmittedMain(t, result); got != "ok" {
					t.Fatalf("accepted program printed %q, want ok", got)
				}
			}
		})
	}
}

func pinnedFlowMain(declarations string, expression string) string {
	return "import { native } from \"smithers:native\"\n" + declarations + "\n" +
		"export function pinned(): unknown { return " + expression + " }\n" +
		"native(pinned)\n" +
		"export function main(): string[] { return [\"ok\"] }\n"
}

func hostPin(path string) []string {
	return []string{`native pin failed: Host<"process"> is required through ` + path}
}

// This table enumerates the visible-body call forms and the value channels
// that may carry a callable, object, or class to such a body. Every row asserts
// the complete retained route rather than accepting the diagnostic code alone.
func TestPinnedForkNativeValueFlowClassesAndRoutes(t *testing.T) {
	runNativeFlowForkCases(t, []nativeFlowForkCase{
		{
			name: "parameter invoked directly",
			main: pinnedFlowMain(
				"function run(cb: () => unknown): unknown { return cb() }",
				"run(() => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "parameter invoked conditionally",
			main: pinnedFlowMain(
				"function run(flag: boolean, cb: () => unknown): unknown { if (flag) return cb(); return 0 }",
				"run(true, () => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "parameter invoked twice is charged once",
			main: pinnedFlowMain(
				"function run(cb: () => unknown): unknown { cb(); return cb() }",
				"run(() => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "parameter forwarded two visible bodies",
			main: pinnedFlowMain(
				"function inner(cb: () => unknown): unknown { return cb() }\n"+
					"function outer(cb: () => unknown): unknown { return inner(cb) }",
				"outer(() => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#outer -> main.sm#inner"),
		},
		{
			name: "parameter stored then invoked",
			main: pinnedFlowMain(
				"function run(cb: () => unknown): unknown { const local = cb; return local() }",
				"run(() => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "parameter invoked through call",
			main: pinnedFlowMain(
				"function run(cb: () => unknown): unknown { return cb.call(null) }",
				"run(() => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "parameter invoked optionally",
			main: pinnedFlowMain(
				"function run(cb?: () => unknown): unknown { return cb?.() }",
				"run(() => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "arrow const callee",
			main: pinnedFlowMain(
				"const run = (cb: () => unknown): unknown => cb()",
				"run(() => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "object method callee",
			main: pinnedFlowMain(
				"const runner = { run(cb: () => unknown): unknown { return cb() } }",
				"runner.run(() => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "named analyzed callback keeps its call graph route",
			main: pinnedFlowMain(
				"function reads(): unknown { return process.pid }\n"+
					"function run(cb: () => unknown): unknown { return cb() }",
				"run(reads)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#reads"),
		},
		{
			name: "callback receives a callback",
			main: pinnedFlowMain(
				"function run(cb: (inner: () => unknown) => unknown): unknown { return cb(() => process.pid) }",
				"run((inner) => inner())",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "object literal reaches interface parameter",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"function run(reader: Reader): unknown { return reader.read() }",
				"run({ read(): unknown { return process.pid } })",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run -> main.sm#read"),
		},
		{
			name: "annotated object binding retains method value",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"const holder: Reader = { read(): unknown { return process.pid } }",
				"holder.read()",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#read"),
		},
		{
			name: "class instance reaches interface parameter",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"class Impl { read(): unknown { return process.pid } }\n"+
					"function run(reader: Reader): unknown { return reader.read() }",
				"run(new Impl())",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run -> main.sm#read"),
		},
		{
			name: "class instance inherits method body",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"class Base { read(): unknown { return process.pid } }\n"+
					"class Impl extends Base {}\n"+
					"function run(reader: Reader): unknown { return reader.read() }",
				"run(new Impl())",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run -> main.sm#read"),
		},
		{
			name: "class instance property arrow",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"class Impl { read = (): unknown => process.pid }\n"+
					"function run(reader: Reader): unknown { return reader.read() }",
				"run(new Impl())",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run -> main.sm#read"),
		},
		{
			name: "class getter reached through structural parameter",
			main: pinnedFlowMain(
				"class Impl { get read(): unknown { return process.pid } }\n"+
					"function run(reader: { read: unknown }): unknown { return reader.read }",
				"run(new Impl())",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run -> main.sm#read"),
		},
		{
			name: "factory result callable",
			main: pinnedFlowMain(
				"function make(): () => unknown { return () => process.pid }\n"+
					"function run(cb: () => unknown): unknown { return cb() }",
				"run(make())",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "factory every return is followed",
			main: pinnedFlowMain(
				"function make(n: number): () => unknown { if (n) return () => 1; return () => process.pid }\n"+
					"function run(cb: () => unknown): unknown { return cb() }",
				"run(make(1))",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "array literal element",
			main: pinnedFlowMain(
				"const callbacks: Array<() => unknown> = [() => process.pid]",
				"callbacks[0]!()",
			),
			wantPins: hostPin("main.sm#pinned"),
		},
		{
			name: "destructured parameter",
			main: pinnedFlowMain(
				"function run({ cb }: { cb: () => unknown }): unknown { return cb() }",
				"run({ cb: () => process.pid })",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run -> main.sm#cb"),
		},
		{
			name: "rest parameter positional read",
			main: pinnedFlowMain(
				"function run(...callbacks: Array<() => unknown>): unknown { return callbacks[0]!() }",
				"run(() => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "rest parameter for of enters every element",
			main: pinnedFlowMain(
				"function run(...callbacks: Array<() => unknown>): unknown { for (const cb of callbacks) cb(); return 1 }",
				"run(() => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "spread argument is flattened positionally",
			main: pinnedFlowMain(
				"function run(cb: () => unknown): unknown { return cb() }",
				"run(...[() => process.pid])",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "object spread republishes own member",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"const base = { read(): unknown { return process.pid } }\n"+
					"function run(reader: Reader): unknown { return reader.read() }",
				"run({ ...base })",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run -> main.sm#read"),
		},
		{
			name: "tagged substitution is bound after strings",
			main: pinnedFlowMain(
				"function tag(strings: TemplateStringsArray, cb: () => unknown): unknown { return cb() }",
				"tag`x${() => process.pid}`",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#tag"),
		},
	})
}

func moduleValueReader() string {
	return "import { value } from \"./config.sm\"\n" +
		"import { native } from \"smithers:native\"\n" +
		"export function pinned(): unknown { return value }\n" +
		"native(pinned)\n" +
		"export function main(): string[] { return [\"ok\"] }\n"
}

func smithersModule(path string, text string) SourceFile {
	return SourceFile{Path: path, Kind: FileKindSmithers, Text: text}
}

// Module initializers have no function row of their own. These rows prove the
// same visible-body/value rule is applied while following an imported binding,
// and that crossing the binding also charges the crossed module's load graph.
func TestPinnedForkNativeModuleValueFlowAndLoadGraph(t *testing.T) {
	runNativeFlowForkCases(t, []nativeFlowForkCase{
		{
			name: "module initializer invokes callback",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"function run(cb: () => unknown): unknown { return cb() }\n"+
					"export const value = run(() => process.pid)\n")},
			wantPins: hostPin("main.sm#pinned -> config.sm#value -> config.sm#run -> process.pid"),
		},
		{
			name: "module initializer class instance",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"interface Reader { read(): unknown }\n"+
					"class Impl { read(): unknown { return process.pid } }\n"+
					"function run(reader: Reader): unknown { return reader.read() }\n"+
					"export const value = run(new Impl())\n")},
			wantPins: hostPin("main.sm#pinned -> config.sm#value -> config.sm#run -> config.sm#read -> process.pid"),
		},
		{
			name: "module initializer getter",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"class Impl { get read(): unknown { return process.pid } }\n"+
					"function run(reader: { read: unknown }): unknown { return reader.read }\n"+
					"export const value = run(new Impl())\n")},
			wantPins: hostPin("main.sm#pinned -> config.sm#value -> config.sm#run -> config.sm#read -> process.pid"),
		},
		{
			name: "module initializer spread argument",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"function run(cb: () => unknown): unknown { return cb() }\n"+
					"export const value = run(...[() => process.pid])\n")},
			wantPins: hostPin("main.sm#pinned -> config.sm#value -> config.sm#run -> process.pid"),
		},
		{
			name: "module initializer iterated rest",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"function run(...callbacks: Array<() => unknown>): unknown { for (const cb of callbacks) cb(); return 1 }\n"+
					"export const value = run(() => process.pid)\n")},
			wantPins: hostPin("main.sm#pinned -> config.sm#value -> config.sm#run -> process.pid"),
		},
		{
			name: "module initializer object spread",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"interface Reader { read(): unknown }\n"+
					"const base = { read(): unknown { return process.pid } }\n"+
					"function run(reader: Reader): unknown { return reader.read() }\n"+
					"export const value = run({ ...base })\n")},
			wantPins: hostPin("main.sm#pinned -> config.sm#value -> config.sm#run -> config.sm#read -> process.pid"),
		},
		{
			name: "module initializer follows every factory return",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"function make(n: number): () => unknown { if (n) return () => 1; return () => process.pid }\n"+
					"function run(cb: () => unknown): unknown { return cb() }\n"+
					"export const value = run(make(1))\n")},
			wantPins: hostPin("main.sm#pinned -> config.sm#value -> config.sm#run -> process.pid"),
		},
		{
			name: "module initializer callee in another module",
			main: moduleValueReader(),
			modules: []SourceFile{
				smithersModule("config.sm", "import { run } from \"./runner.sm\"\nexport const value = run(() => process.pid)\n"),
				smithersModule("runner.sm", "export function run(cb: () => unknown): unknown { return cb() }\n"),
			},
			wantPins: hostPin("main.sm#pinned -> config.sm#value -> runner.sm#run -> process.pid"),
		},
		{
			name: "side effect import graph is transitive",
			main: "import \"./a.sm\"\n" + pinnedFlowMain("", "1"),
			modules: []SourceFile{
				smithersModule("a.sm", "import \"./b.sm\"\nexport const a = 1\n"),
				smithersModule("b.sm", "import \"node:fs\"\nexport const b = 1\n"),
			},
			wantPins: []string{`native pin failed: Module<"node:fs"> is required through main.sm#pinned -> a.sm -> b.sm -> node:fs`},
		},
		{
			name: "crossed project binding carries its load graph",
			main: moduleValueReader(),
			modules: []SourceFile{
				smithersModule("config.sm", "import \"./loads.sm\"\nexport const value = 1\n"),
				smithersModule("loads.sm", "import \"node:fs\"\n"),
			},
			wantPins: []string{`native pin failed: Module<"node:fs"> is required through main.sm#pinned -> config.sm -> loads.sm -> node:fs`},
		},
		{
			name: "load cycle terminates and retains edge behind it",
			main: "import \"./a.sm\"\n" + pinnedFlowMain("", "1"),
			modules: []SourceFile{
				smithersModule("a.sm", "import \"./b.sm\"\n"),
				smithersModule("b.sm", "import \"./a.sm\"\nimport \"node:fs\"\n"),
			},
			wantPins: []string{`native pin failed: Module<"node:fs"> is required through main.sm#pinned -> a.sm -> b.sm -> node:fs`},
		},
	})
}

// Every newly-entered channel has an acceptance twin. The last six rows pin
// the reference analyzer's deliberate unresolved boundary; they are not
// certifications that those host operations are portable, only proof that the
// Go bridge does not invent a broader refusal than the reference implements.
func TestPinnedForkNativeValueFlowAcceptanceBoundaries(t *testing.T) {
	runNativeFlowForkCases(t, []nativeFlowForkCase{
		{
			name: "keep only returns callback",
			main: pinnedFlowMain(
				"function keep(cb: () => unknown): () => unknown { return cb }",
				"keep(() => eval(\"1\"))",
			),
			accept: true,
		},
		{
			name:   "array map body is unavailable",
			main:   pinnedFlowMain("", "[1].map(() => eval(\"1\"))"),
			accept: true,
		},
		{
			name: "keep at module level only returns callback",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"function keep(cb: () => unknown): () => unknown { return cb }\n"+
					"export const value = keep(() => eval(\"1\"))\n")},
			accept: true,
		},
		{
			name: "array map at module level stays unavailable",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"export const value = [1].map(() => eval(\"1\"))\n")},
			accept: true,
		},
		{
			name: "keep and map remain deferred inside entered class method",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"function keep(cb: () => unknown): () => unknown { return cb }\n"+
					"class Impl { read(): unknown { keep(() => eval(\"1\")); return [1].map(() => eval(\"1\")) } }\n"+
					"function run(reader: Reader): unknown { return reader.read() }",
				"run(new Impl())",
			),
			accept: true,
		},
		{
			name: "keep and map remain deferred inside module entered callback",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"function keep(cb: () => unknown): () => unknown { return cb }\n"+
					"function run(cb: () => unknown): unknown { return cb() }\n"+
					"export const value = run(() => { keep(() => eval(\"1\")); return [1].map(() => eval(\"1\")) })\n")},
			accept: true,
		},
		{
			name:   "callable merely defined",
			main:   pinnedFlowMain("", "(() => { const deferred = () => eval(\"1\"); return deferred })()"),
			accept: true,
		},
		{
			name:   "callable merely stored",
			main:   pinnedFlowMain("", "(() => { const deferred = () => eval(\"1\"); return [deferred] })()"),
			accept: true,
		},
		{
			name: "class method exists but is never called",
			main: pinnedFlowMain(
				"class Impl { read(): unknown { return eval(\"1\") } }",
				"new Impl().read",
			),
			accept: true,
		},
		{
			name: "clean override shadows host reading base method",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"class Base { read(): unknown { return eval(\"1\") } }\n"+
					"class Impl extends Base { read(): unknown { return 1 } }\n"+
					"function run(reader: Reader): unknown { return reader.read() }",
				"run(new Impl())",
			),
			accept: true,
		},
		{
			name: "spread mapping skips second callback",
			main: pinnedFlowMain(
				"function run(a: () => unknown, b: () => unknown): unknown { return a() }",
				"run(...[() => 1, () => eval(\"1\")])",
			),
			accept: true,
		},
		{
			name: "tag mapping skips second substitution",
			main: pinnedFlowMain(
				"function tag(strings: TemplateStringsArray, a: () => unknown, b: () => unknown): unknown { return a() }",
				"tag`x${() => 1}y${() => eval(\"1\")}`",
			),
			accept: true,
		},
		{
			name: "type only import adds no runtime requirement",
			main: "import type { Shape } from \"./types.ts\"\n" +
				pinnedFlowMain(
					"function read(shape: Shape): number { return shape.n }",
					"read({ n: 1 })",
				),
			modules: []SourceFile{{
				Path: "types.ts", Kind: FileKindTypeScript,
				Text: "/**\n * @module\n * @throws {never}\n */\nexport interface Shape { n: number }\n",
			}},
			accept: true,
		},
		{
			name: "compile time asset edge",
			main: "import config from \"./config.json\" with { type: \"json\", mode: \"const\" }\n" +
				pinnedFlowMain("", "config.answer"),
			modules: []SourceFile{{Path: "config.json", Kind: FileKindAsset, Text: `{"answer": 42}`}},
			accept:  true,
		},
		{
			name:   "compiler owned virtual module",
			main:   pinnedFlowMain("", "typeof native"),
			accept: true,
		},
		{
			name: "clean project binding",
			main: moduleValueReader(),
			modules: []SourceFile{smithersModule("config.sm",
				"export const value = 7\n")},
			accept: true,
		},
		{
			name: "clean project load cycle terminates",
			main: "import \"./a.sm\"\n" + pinnedFlowMain("", "1"),
			modules: []SourceFile{
				smithersModule("a.sm", "import \"./b.sm\"\n"),
				smithersModule("b.sm", "import \"./a.sm\"\n"),
			},
			accept: true,
		},
		{
			name: "host container forEach stays unresolved",
			main: pinnedFlowMain(
				"function run(...callbacks: Array<() => unknown>): unknown { callbacks.forEach((cb) => cb()); return 1 }",
				"run(() => eval(\"1\"))",
			),
			accept: true,
		},
		{
			name: "host Map stays unresolved",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"const reader: Reader = { read(): unknown { return eval(\"1\") } }",
				`new Map<string, Reader>([["a", reader]]).get("a")!.read()`,
			),
			accept: true,
		},
		{
			name: "host Set stays unresolved",
			main: pinnedFlowMain(
				"const callbacks = new Set<() => unknown>([() => eval(\"1\")])",
				"(() => { for (const cb of callbacks) return cb(); return 1 })()",
			),
			accept: true,
		},
		{
			name: "interface value with no literal stays unresolved",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\ndeclare const reader: Reader",
				"reader.read()",
			),
			accept: true,
		},
		{
			name: "non literal index stays unresolved",
			main: pinnedFlowMain(
				"const callbacks: Array<() => unknown> = [() => eval(\"1\")]\nconst index = 0",
				"callbacks[index]!()",
			),
			accept: true,
		},
		{
			name: "spread source with unknown arity stays unresolved",
			main: pinnedFlowMain(
				"declare const callbacks: Array<() => unknown>\n"+
					"function run(...callbacks: Array<() => unknown>): unknown { return callbacks[0]!() }",
				"run(...callbacks)",
			),
			accept: true,
		},
		{
			name: "setter stays unresolved",
			main: pinnedFlowMain(
				"class Impl { set read(value: number) { void eval(\"1\") } }",
				"(() => { const receiver = new Impl(); receiver.read = 1; return 1 })()",
			),
			accept: true,
		},
		{
			name: "object spread source getter stays unresolved",
			main: pinnedFlowMain(
				"const base = { get read(): unknown { return eval(\"1\") } }",
				"({ ...base })",
			),
			accept: true,
		},
	})
}

func TestPinnedForkNativeBlockingRequirementsCannotBeProvided(t *testing.T) {
	capability := "import { Context } from \"smthrs/context\"\n" +
		"import { Layer } from \"smthrs/provider\"\n" +
		"abstract class TypeScript extends Context { abstract readonly value: number }\n" +
		"const layer = Layer.succeed(TypeScript, { value: 1 })\n" +
		"export function scoped(): unknown { return Layer.provide(layer, () => eval(\"1\")) }\n"
	runNativeFlowForkCases(t, []nativeFlowForkCase{
		{
			name: "capability name TypeScript cannot subtract builtin requirement",
			main: "import { native } from \"smithers:native\"\n" + capability +
				"native(scoped)\nexport function main(): string[] { return [\"ok\"] }\n",
			wantPins: []string{"native pin failed: TypeScript is required through main.sm#scoped"},
		},
		{
			name: "ordinary capability provision remains accepted",
			main: "import { native } from \"smithers:native\"\n" +
				"import { Context } from \"smthrs/context\"\n" +
				"import { Layer } from \"smthrs/provider\"\n" +
				"abstract class Config extends Context { abstract readonly value: number }\n" +
				"const layer = Layer.succeed(Config, { value: 1 })\n" +
				"export function scoped(): unknown { return Layer.provide(layer, () => Config.context().value) }\n" +
				"native(scoped)\nexport function main(): string[] { return [\"ok\"] }\n",
			accept: true,
		},
	})
}

func TestPinnedForkNativeFlowTerminationUsesStructuralBindings(t *testing.T) {
	runNativeFlowForkCases(t, []nativeFlowForkCase{
		{
			name: "recursive higher order callee reaches callback",
			main: pinnedFlowMain(
				"function run(n: number, cb: () => unknown): unknown { if (n > 0) return run(n - 1, cb); return cb() }",
				"run(2, () => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "mutual recursion reaches callback behind cycle",
			main: pinnedFlowMain(
				"function a(n: number, cb: () => unknown): unknown { if (n > 0) return b(n - 1, cb); return 0 }\n"+
					"function b(n: number, cb: () => unknown): unknown { if (n > 0) return a(n - 1, cb); return cb() }",
				"a(1, () => process.pid)",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#a -> main.sm#b"),
		},
		{
			name: "mutual recursion never invoking callback stays accepted",
			main: pinnedFlowMain(
				"function a(n: number, cb: () => unknown): unknown { if (n > 0) return b(n - 1, cb); return 0 }\n"+
					"function b(n: number, cb: () => unknown): unknown { if (n > 0) return a(n - 1, cb); return 1 }",
				"a(2, () => eval(\"1\"))",
			),
			accept: true,
		},
		{
			name: "second callback through same callee is not dropped",
			main: pinnedFlowMain(
				"function run(cb: () => unknown): unknown { return cb() }",
				"[run(() => 1), run(() => process.pid)]",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "second class through same callee is not dropped",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"class Clean { read(): unknown { return 1 } }\n"+
					"class Host { read(): unknown { return process.pid } }\n"+
					"function run(reader: Reader): unknown { return reader.read() }",
				"[run(new Clean()), run(new Host())]",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run -> main.sm#read"),
		},
		{
			name: "class hierarchy three deep reaches inherited method",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"class Base { read(): unknown { return process.pid } }\n"+
					"class Middle extends Base {}\n"+
					"class Leaf extends Middle {}\n"+
					"function run(reader: Reader): unknown { return reader.read() }",
				"run(new Leaf())",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run -> main.sm#read"),
		},
		{
			name: "method returning own class terminates",
			main: pinnedFlowMain(
				"interface Reader { read(): unknown }\n"+
					"class Impl { self(): Impl { return new Impl() } read(): unknown { return process.pid } }\n"+
					"function run(reader: Reader): unknown { return reader.read() }",
				"run(new Impl().self().self())",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run -> main.sm#read"),
		},
		{
			name: "mutually recursive clean factories terminate",
			main: pinnedFlowMain(
				"function a(): () => unknown { return b() }\n"+
					"function b(): () => unknown { return a() }\n"+
					"function run(cb: () => unknown): unknown { return cb() }",
				"run(a())",
			),
			accept: true,
		},
		{
			name: "mutually recursive factory reaches alternate return",
			main: pinnedFlowMain(
				"function a(n: number): () => unknown { if (n > 0) return b(n - 1); return () => process.pid }\n"+
					"function b(n: number): () => unknown { return a(n - 1) }\n"+
					"function run(cb: () => unknown): unknown { return cb() }",
				"run(a(2))",
			),
			wantPins: hostPin("main.sm#pinned -> main.sm#run"),
		},
		{
			name: "self referential positional list terminates cleanly",
			main: pinnedFlowMain(
				"const callbacks: Array<() => unknown> = [() => callbacks[0]!()]",
				"callbacks[0]!()",
			),
			accept: true,
		},
	})
}
