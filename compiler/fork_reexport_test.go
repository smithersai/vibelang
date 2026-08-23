package compiler

import (
	"strings"
	"testing"
)

func compilePinnedNativeProject(t *testing.T, backend Compiler, source string, extras ...SourceFile) CompileResult {
	t.Helper()
	files := append([]SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}, extras...)
	result, err := backend.Compile(t.Context(), CompileRequest{
		RootNames: []string{"main.sm"},
		Files:     files,
		Options:   Options{},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func diagnosticMessages(result CompileResult, code string) []string {
	messages := make([]string, 0)
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Code == code {
			messages = append(messages, diagnostic.Message)
		}
	}
	return messages
}

func requireOnePinPath(t *testing.T, result CompileResult, requirement string, path string) {
	t.Helper()
	messages := diagnosticMessages(result, "SMITHERS3001")
	want := "native pin failed: " + requirement + " is required through " + path
	if len(messages) != 1 || messages[0] != want {
		t.Fatalf("SMITHERS3001 messages %#v, want [%q]; all diagnostics %#v", messages, want, result.Diagnostics)
	}
}

func requireNoDiagnostic(t *testing.T, result CompileResult, code string) {
	t.Helper()
	if messages := diagnosticMessages(result, code); len(messages) != 0 {
		t.Fatalf("unexpected %s diagnostics %#v; all diagnostics %#v", code, messages, result.Diagnostics)
	}
}

func nativeReExportMain(importLine string, leafExpression string) string {
	return "import { native } from \"smithers:native\"\n" + importLine + "\n" +
		"function leaf(): number { return " + leafExpression + " }\n" +
		"function pinned(input: string): number { return input.length + leaf() }\n" +
		"native(pinned)\n" +
		"export function main(): string[] { return [String(pinned(\"smithers\"))] }\n"
}

// The refusal table enumerates every value re-binding spelling from the
// reference fix. Each row must reach the same host edge and retain both the
// call path and laundering module in the diagnostic.
func TestPinnedForkNativePinFollowsEveryReExportBindingForm(t *testing.T) {
	backend, _ := newPinnedTestBackend(t)
	type testCase struct {
		name        string
		importLine  string
		leaf        string
		launder     string
		extras      []SourceFile
		requirement string
		terminal    string
	}
	cases := []testCase{
		{
			name: "named re-export", importLine: `import { read } from "./launder.sm"`,
			leaf:        `typeof read === "function" ? 1 : 0`,
			launder:     `export { readFileSync as read } from "node:fs"` + "\n",
			requirement: `Module<"node:fs">`, terminal: "node:fs",
		},
		{
			name: "star re-export", importLine: `import { readFileSync } from "./launder.sm"`,
			leaf:        `typeof readFileSync === "function" ? 1 : 0`,
			launder:     `export * from "node:fs"` + "\n",
			requirement: `Module<"node:fs">`, terminal: "node:fs",
		},
		{
			name: "namespace re-export", importLine: `import { fs } from "./launder.sm"`,
			leaf:        `typeof fs.readFileSync === "function" ? 1 : 0`,
			launder:     `export * as fs from "node:fs"` + "\n",
			requirement: `Module<"node:fs">`, terminal: "node:fs",
		},
		{
			name: "import then export", importLine: `import { read } from "./launder.sm"`,
			leaf:        `typeof read === "function" ? 1 : 0`,
			launder:     "import { readFileSync as read } from \"node:fs\"\nexport { read }\n",
			requirement: `Module<"node:fs">`, terminal: "node:fs",
		},
		{
			name: "rename through export", importLine: `import { read } from "./launder.sm"`,
			leaf:        `typeof read === "function" ? 1 : 0`,
			launder:     "import { readFileSync as local } from \"node:fs\"\nexport { local as read }\n",
			requirement: `Module<"node:fs">`, terminal: "node:fs",
		},
		{
			name: "value binding", importLine: `import { read } from "./launder.sm"`,
			leaf:        `typeof read === "function" ? 1 : 0`,
			launder:     "import * as fs from \"node:fs\"\nexport const read = fs.readFileSync\n",
			requirement: `Module<"node:fs">`, terminal: "node:fs",
		},
		{
			name: "destructured value binding", importLine: `import { read } from "./launder.sm"`,
			leaf:        `typeof read === "function" ? 1 : 0`,
			launder:     "import * as fs from \"node:fs\"\nexport const { readFileSync: read } = fs\n",
			requirement: `Module<"node:fs">`, terminal: "node:fs",
		},
		{
			name: "default export expression", importLine: `import read from "./launder.sm"`,
			leaf:        `typeof read === "function" ? 1 : 0`,
			launder:     "import { readFileSync } from \"node:fs\"\nexport default readFileSync\n",
			requirement: `Module<"node:fs">`, terminal: "node:fs",
		},
		{
			name: "default as named", importLine: `import { read } from "./launder.sm"`,
			leaf:    `typeof read === "function" ? 1 : 0`,
			launder: `export { default as read } from "./foreign.ts"` + "\n",
			extras: []SourceFile{{Path: "foreign.ts", Kind: FileKindTypeScript,
				Text: "export default function read(): number { return 1 }\n"}},
			requirement: "TypeScript", terminal: "./foreign.ts",
		},
		{
			name: "namespace import of launderer", importLine: `import * as laundry from "./launder.sm"`,
			leaf:        `typeof laundry.read === "function" ? 1 : 0`,
			launder:     `export { readFileSync as read } from "node:fs"` + "\n",
			requirement: `Module<"node:fs">`, terminal: "node:fs",
		},
		{
			name: "whole laundering namespace", importLine: `import * as laundry from "./launder.sm"`,
			leaf:        `typeof laundry === "object" ? 1 : 0`,
			launder:     `export { readFileSync as read } from "node:fs"` + "\n",
			requirement: `Module<"node:fs">`, terminal: "node:fs",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			extras := []SourceFile{{Path: "launder.sm", Kind: FileKindSmithers, Text: testCase.launder}}
			extras = append(extras, testCase.extras...)
			result := compilePinnedNativeProject(t, backend,
				nativeReExportMain(testCase.importLine, testCase.leaf), extras...)
			requireOnePinPath(t, result, testCase.requirement,
				"main.sm#pinned -> main.sm#leaf -> launder.sm -> "+testCase.terminal)
			if len(diagnosticMessages(result, "SMITHERS1510")) != 1 {
				t.Fatalf("runtime re-export must have one module trust refusal: %#v", result.Diagnostics)
			}
		})
	}
}

func TestPinnedForkNativePinReExportPathsComposeAndCyclesTerminate(t *testing.T) {
	backend, _ := newPinnedTestBackend(t)
	main := nativeReExportMain(`import { read } from "./outer.sm"`, `typeof read === "function" ? 1 : 0`)

	t.Run("two named hops", func(t *testing.T) {
		result := compilePinnedNativeProject(t, backend, main,
			SourceFile{Path: "outer.sm", Kind: FileKindSmithers, Text: `export { read } from "./inner.sm"` + "\n"},
			SourceFile{Path: "inner.sm", Kind: FileKindSmithers, Text: `export { readFileSync as read } from "node:fs"` + "\n"},
		)
		requireOnePinPath(t, result, `Module<"node:fs">`,
			"main.sm#pinned -> main.sm#leaf -> outer.sm -> inner.sm -> node:fs")
	})

	t.Run("a two-module cycle still reaches its foreign edge", func(t *testing.T) {
		result := compilePinnedNativeProject(t, backend, main,
			SourceFile{Path: "outer.sm", Kind: FileKindSmithers,
				Text: "export { read } from \"./inner.sm\"\nexport const LIMIT = 1\n"},
			SourceFile{Path: "inner.sm", Kind: FileKindSmithers,
				Text: "export { LIMIT } from \"./outer.sm\"\nexport { readFileSync as read } from \"node:fs\"\n"},
		)
		requireOnePinPath(t, result, `Module<"node:fs">`,
			"main.sm#pinned -> main.sm#leaf -> outer.sm -> inner.sm -> node:fs")
	})

	t.Run("a clean two-module cycle terminates without inventing a requirement", func(t *testing.T) {
		cleanMain := nativeReExportMain(`import { LIMIT } from "./outer.sm"`, "LIMIT")
		result := compilePinnedNativeProject(t, backend, cleanMain,
			SourceFile{Path: "outer.sm", Kind: FileKindSmithers,
				Text: "export { LIMIT } from \"./inner.sm\"\nexport const STEP = 2\n"},
			SourceFile{Path: "inner.sm", Kind: FileKindSmithers,
				Text: "export { STEP } from \"./outer.sm\"\nexport const LIMIT = 1\n"},
		)
		requireNoDiagnostic(t, result, "SMITHERS3001")
	})

	t.Run("a parameter default executes in its function", func(t *testing.T) {
		source := "import { native } from \"smithers:native\"\n" +
			"import { readFileSync } from \"node:fs\"\n" +
			"function pinned(read = readFileSync): number { return typeof read === \"function\" ? 1 : 0 }\n" +
			"native(pinned)\nexport function main(): string[] { return [\"unreachable\"] }\n"
		result := compilePinnedNativeProject(t, backend, source)
		requireOnePinPath(t, result, `Module<"node:fs">`, "main.sm#pinned")
	})
}

func TestPinnedForkReExportAcceptanceControls(t *testing.T) {
	backend, _ := newPinnedTestBackend(t)

	t.Run("ordinary project values through named and star exports", func(t *testing.T) {
		source := "import { native } from \"smithers:native\"\n" +
			"import { LIMIT } from \"./named.sm\"\nimport { STEP } from \"./star.sm\"\n" +
			"function pinned(input: string): number { return input.length + LIMIT + STEP }\n" +
			"native(pinned)\nexport function main(): string[] { return [String(pinned(\"x\"))] }\n"
		result := compilePinnedNativeProject(t, backend, source,
			SourceFile{Path: "named.sm", Kind: FileKindSmithers, Text: `export { LIMIT } from "./values.sm"` + "\n"},
			SourceFile{Path: "star.sm", Kind: FileKindSmithers, Text: `export * from "./values.sm"` + "\n"},
			SourceFile{Path: "values.sm", Kind: FileKindSmithers, Text: "export const LIMIT = 1\nexport const STEP = 2\n"},
		)
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("clean re-exports must compile: %#v", result.Diagnostics)
		}
	})

	t.Run("type-only re-export", func(t *testing.T) {
		source := "import { native } from \"smithers:native\"\n" +
			"import type { Settings } from \"./types.sm\"\n" +
			"function pinned(value: Settings | undefined): number { return value === undefined ? 0 : 1 }\n" +
			"native(pinned)\nexport function main(): string[] { return [String(pinned(undefined))] }\n"
		result := compilePinnedNativeProject(t, backend, source,
			SourceFile{Path: "types.sm", Kind: FileKindSmithers, Text: `export type { Settings } from "./foreign.ts"` + "\n"},
			SourceFile{Path: "foreign.ts", Kind: FileKindTypeScript, Text: "export interface Settings { readonly size: number }\n"},
		)
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("type-only re-export must add no runtime requirement: %#v", result.Diagnostics)
		}
	})

	t.Run("compiler-owned virtual modules", func(t *testing.T) {
		source := "import { native } from \"smithers:native\"\n" +
			"import { Layer, Context } from \"./compiler.sm\"\n" +
			"function pinned(): number { void Layer; void Context; return 1 }\n" +
			"native(pinned)\nexport function main(): string[] { return [String(pinned())] }\n"
		result := compilePinnedNativeProject(t, backend, source,
			SourceFile{Path: "compiler.sm", Kind: FileKindSmithers,
				Text: "export { Layer } from \"smthrs/provider\"\nexport * from \"smthrs/context\"\n"},
		)
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("compiler-owned re-exports must remain requirement-free: %#v", result.Diagnostics)
		}
		if got := runEmittedMain(t, result); got != "1" {
			t.Fatalf("compiler-owned re-export program printed %q", got)
		}
	})

	t.Run("compile-time asset re-export", func(t *testing.T) {
		source := "import { native } from \"smithers:native\"\n" +
			"import { config } from \"./asset.sm\"\n" +
			"function pinned(): number { return config.answer }\n" +
			"native(pinned)\nexport function main(): string[] { return [String(pinned())] }\n"
		result := compilePinnedNativeProject(t, backend, source,
			SourceFile{Path: "asset.sm", Kind: FileKindSmithers,
				Text: `export { default as config } from "./config.json" with { type: "json", mode: "const" }` + "\n"},
			SourceFile{Path: "config.json", Kind: FileKindAsset, Text: `{"answer":42}`},
		)
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("asset re-export must remain compile-time-only: %#v", result.Diagnostics)
		}
		if got := runEmittedMain(t, result); got != "42" {
			t.Fatalf("asset re-export program printed %q", got)
		}
		for path, text := range artifactTextsByPath(t, result.Artifacts) {
			if strings.HasSuffix(path, ".js") && strings.Contains(text, "config.json") {
				t.Fatalf("asset specifier reached runtime artifact %s:\n%s", path, text)
			}
		}
	})
}

func TestPinnedForkNativePinFollowsModuleInitializers(t *testing.T) {
	backend, _ := newPinnedTestBackend(t)
	main := nativeReExportMain(`import { pid as read } from "./config.sm"`, "read")

	t.Run("ambient host authority", func(t *testing.T) {
		result := compilePinnedNativeProject(t, backend, main,
			SourceFile{Path: "config.sm", Kind: FileKindSmithers, Text: "export const pid = process.pid\n"})
		requireOnePinPath(t, result, `Host<"process">`,
			"main.sm#pinned -> main.sm#leaf -> config.sm#pid -> process.pid")
	})

	t.Run("destructured ambient host authority", func(t *testing.T) {
		result := compilePinnedNativeProject(t, backend, main,
			SourceFile{Path: "config.sm", Kind: FileKindSmithers, Text: "export const { pid } = process\n"})
		requireOnePinPath(t, result, `Host<"process">`,
			"main.sm#pinned -> main.sm#leaf -> config.sm#pid -> process")
	})

	t.Run("default ambient host authority", func(t *testing.T) {
		defaultMain := nativeReExportMain(`import read from "./config.sm"`, "read")
		result := compilePinnedNativeProject(t, backend, defaultMain,
			SourceFile{Path: "config.sm", Kind: FileKindSmithers, Text: "export default process.pid\n"})
		requireOnePinPath(t, result, `Host<"process">`,
			"main.sm#pinned -> main.sm#leaf -> config.sm#default -> process.pid")
	})

	t.Run("an invoked initializer callable executes", func(t *testing.T) {
		result := compilePinnedNativeProject(t, backend, main,
			SourceFile{Path: "config.sm", Kind: FileKindSmithers, Text: "export const pid = (() => process.pid)()\n"})
		requireOnePinPath(t, result, `Host<"process">`,
			"main.sm#pinned -> main.sm#leaf -> config.sm#pid -> process.pid")
	})

	t.Run("an invoked initializer composes through a re-export", func(t *testing.T) {
		outerMain := nativeReExportMain(`import { pid as read } from "./outer.sm"`, "read")
		result := compilePinnedNativeProject(t, backend, outerMain,
			SourceFile{Path: "outer.sm", Kind: FileKindSmithers, Text: `export { pid } from "./config.sm"` + "\n"},
			SourceFile{Path: "config.sm", Kind: FileKindSmithers, Text: "export const pid = (() => process.pid)()\n"},
		)
		requireOnePinPath(t, result, `Host<"process">`,
			"main.sm#pinned -> main.sm#leaf -> outer.sm -> config.sm#pid -> process.pid")
	})

	t.Run("a merely defined callable stays deferred", func(t *testing.T) {
		deferredMain := nativeReExportMain(`import { deferred as read } from "./config.sm"`,
			`typeof read === "function" ? 1 : 0`)
		result := compilePinnedNativeProject(t, backend, deferredMain,
			SourceFile{Path: "config.sm", Kind: FileKindSmithers, Text: "export const deferred = () => process.pid\n"})
		requireNoDiagnostic(t, result, "SMITHERS3001")
	})

	t.Run("pure and shadowed initializers stay ordinary", func(t *testing.T) {
		result := compilePinnedNativeProject(t, backend, main,
			SourceFile{Path: "config.sm", Kind: FileKindSmithers,
				Text: "const process = { pid: 7 }\nexport const pid = process.pid\n"})
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("shadowed initializer must remain ordinary: %#v", result.Diagnostics)
		}
	})

	t.Run("Date.parse in an initializer stays pure", func(t *testing.T) {
		parsedMain := nativeReExportMain(`import { parsed as read } from "./config.sm"`, "read")
		result := compilePinnedNativeProject(t, backend, parsedMain,
			SourceFile{Path: "config.sm", Kind: FileKindSmithers,
				Text: `export const parsed = Date.parse("2020-01-01")` + "\n"})
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("pure Date initializer must remain ordinary: %#v", result.Diagnostics)
		}
	})
}

func TestPinnedForkNativePinFollowsInvokedWhereDefinedCallables(t *testing.T) {
	backend, _ := newPinnedTestBackend(t)
	type iifeCase struct {
		name   string
		prefix string
		expr   string
		path   string
	}
	cases := []iifeCase{
		{name: "arrow call", expr: `(() => process.pid)()`},
		{name: "function expression call", expr: `(function () { return process.pid })()`},
		{name: "async arrow call", expr: `(async () => process.pid)()`},
		{name: "call method", expr: `(() => process.pid).call(null)`},
		{name: "apply method", expr: `(() => process.pid).apply(null)`},
		{name: "bound result invoked", expr: `(() => process.pid).bind(null)()`},
		{name: "named function expression", expr: `(function read() { return process.pid })()`},
		{name: "object literal", expr: `({ pid: (() => process.pid)() })`},
		{name: "array literal", expr: `[(() => process.pid)()]`},
		{name: "accumulation after clock", expr: `({ at: Date.now(), pid: (() => process.pid)() })`},
		{name: "constructor", expr: `new (function (this: { pid?: number }) { this.pid = process.pid })()`},
		{name: "optional call", expr: `(() => process.pid)?.()`},
		{name: "tagged template", expr: "((parts: TemplateStringsArray) => process.pid)`x`"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			source := "import { native } from \"smithers:native\"\n" + testCase.prefix +
				"function pinned(): unknown { return " + testCase.expr + " }\n" +
				"native(pinned)\nexport function main(): string[] { return [\"unreachable\"] }\n"
			result := compilePinnedNativeProject(t, backend, source)
			requireOnePinPath(t, result, `Host<"process">`, "main.sm#pinned")
		})
	}

	t.Run("call graph inside an IIFE", func(t *testing.T) {
		source := "import { native } from \"smithers:native\"\n" +
			"function helper(): number { return process.pid }\n" +
			"function pinned(): number { return (() => helper())() }\n" +
			"native(pinned)\nexport function main(): string[] { return [\"unreachable\"] }\n"
		result := compilePinnedNativeProject(t, backend, source)
		requireOnePinPath(t, result, `Host<"process">`, "main.sm#pinned -> main.sm#helper")
	})

	t.Run("foreign module edge inside an IIFE", func(t *testing.T) {
		source := "import { native } from \"smithers:native\"\n" +
			"import { readFileSync } from \"node:fs\"\n" +
			"function pinned(): number { return (() => typeof readFileSync === \"function\" ? 1 : 0)() }\n" +
			"native(pinned)\nexport function main(): string[] { return [\"unreachable\"] }\n"
		result := compilePinnedNativeProject(t, backend, source)
		requireOnePinPath(t, result, `Module<"node:fs">`, "main.sm#pinned")
	})

	t.Run("eval inside an IIFE", func(t *testing.T) {
		source := "import { native } from \"smithers:native\"\n" +
			"function pinned(): unknown { return (() => eval(\"1\"))() }\n" +
			"native(pinned)\nexport function main(): string[] { return [\"unreachable\"] }\n"
		result := compilePinnedNativeProject(t, backend, source)
		requireOnePinPath(t, result, "TypeScript", "main.sm#pinned")
	})

	negative := []struct {
		name string
		expr string
	}{
		{name: "callable merely defined", expr: `() => process.pid`},
		{name: "callable merely bound", expr: `(() => process.pid).bind(null)`},
		{name: "IIFE inside deferred closure", expr: `() => (() => process.pid)()`},
		{name: "IIFE returns deferred closure", expr: `(() => () => process.pid)()`},
		{name: "ordinary boolean negation", expr: `!(() => process.pid)`},
		{name: "pure date operation", expr: `(() => Date.parse("2020-01-01"))()`},
		{name: "lexically shadowed parameter", expr: `((process: { pid: number }) => process.pid)({ pid: 7 })`},
	}
	for _, testCase := range negative {
		t.Run(testCase.name, func(t *testing.T) {
			source := "import { native } from \"smithers:native\"\n" +
				"function pinned(): unknown { return " + testCase.expr + " }\n" +
				"native(pinned)\nexport function main(): string[] { return [\"ordinary\"] }\n"
			result := compilePinnedNativeProject(t, backend, source)
			requireNoDiagnostic(t, result, "SMITHERS3001")
		})
	}
}
