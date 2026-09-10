package compiler

import (
	"strings"
	"testing"
	"unicode/utf16"
)

func nativeTypeScriptRequest(source string) CompileRequest {
	return CompileRequest{
		RootNames: []string{"turn.ts", "surface.d.ts", "__check.ts"},
		Lowering:  LoweringTypeScript,
		Options: Options{
			"target": "ES2022", "module": "ES2022", "moduleResolution": "bundler",
			"lib": []string{"ES2022"}, "types": []string{}, "strict": true,
			"skipLibCheck": true, "noEmitOnError": true, "sourceMap": true,
		},
		Files: []SourceFile{
			{Path: "turn.ts", Kind: FileKindTypeScript, Text: source},
			{Path: "surface.d.ts", Kind: FileKindTypeScript, Text: `interface Functions { double(value: number): Promise<number> }`},
			{Path: "__check.ts", Kind: FileKindTypeScript, Text: `import turn from "./turn.js";
const checked: (functions: Functions) => unknown | Promise<unknown> = turn;
void checked;`},
		},
		SourcePolicy: &SourcePolicy{
			Files: []string{"turn.ts"}, DiagnosticCode: "91001", MessagePrefix: "Generated-turn sandbox policy: ",
			ForbidModuleSyntax:   true,
			ForbiddenIdentifiers: []string{"eval", "Function", "Worker", "require", "ShadowRealm"},
		},
	}
}

func TestPinnedForkNativeTypeScript(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	const good = `export default async function turn(functions: Functions): Promise<number> { return functions.double(21); }`

	t.Run("checks and emits an isolated in-memory module graph", func(t *testing.T) {
		result, err := backend.Compile(ctx, nativeTypeScriptRequest(good))
		if err != nil {
			t.Fatal(err)
		}
		requireClean(t, result)
		outputs := artifactTextsByPath(t, result.Artifacts)
		if !strings.Contains(outputs["turn.js"], "functions.double(21)") || strings.Contains(outputs["turn.js"], ": Functions") {
			t.Fatalf("not a native JavaScript artifact: %#v", outputs)
		}
		if outputs["turn.js.map"] == "" || outputs["__check.js"] == "" {
			t.Fatal("incomplete native outputs")
		}
	})

	for _, vector := range []struct{ name, source, code string }{
		{"wrong argument", `export default (f: Functions) => f.double("wrong")`, "TS2345"},
		{"wrong default contract", `export default 42`, "TS2322"},
		{"missing default", `export const answer = 42`, "TS1192"},
		{"no ambient Node", `export default () => process.env.SECRET`, "TS2591"},
		{"no ambient DOM", `export default () => document.title`, "TS2584"},
		{"no ambient Bun", `export default () => Bun.version`, "TS2868"},
		{"module import", `import { x } from "./hidden.js"; export default () => x`, "91001"},
		{"import equals", `import fs = require("node:fs"); export default () => fs`, "91001"},
		{"module reexport", `export { x } from "./hidden.js"; export default () => 1`, "91001"},
		{"import type", `type T = import("./hidden.js").T; export default () => 1`, "91001"},
		{"import meta", `export default () => import.meta.url`, "91001"},
		{"dynamic import", `export default () => import("node:fs")`, "91001"},
		{"eval", `export default () => eval("42")`, "91001"},
		{"Function constructor", `export default () => Function("return 42")()`, "91001"},
		{"escaped identifier", `export default () => \u0065val("42")`, "91001"},
		{"forbidden property", `export default () => ({ require: 42 })`, "91001"},
	} {
		t.Run(vector.name, func(t *testing.T) {
			request := nativeTypeScriptRequest(vector.source)
			// Source policy must refuse emission even if a host permits emit on TS errors.
			if vector.code == "91001" {
				request.Options["noEmitOnError"] = false
			}
			result, err := backend.Compile(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			requireCode(t, result, vector.code, "")
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatalf("rejected input emitted: %+v", result)
			}
		})
	}

	t.Run("strings and comments are not identifiers or imports", func(t *testing.T) {
		result, err := backend.Compile(ctx, nativeTypeScriptRequest(`// import Function from "eval"
export default () => "Worker require import.meta"`))
		if err != nil {
			t.Fatal(err)
		}
		requireClean(t, result)
	})
	t.Run("policy is scoped to its named files", func(t *testing.T) {
		request := nativeTypeScriptRequest(good)
		request.Files[1].Text += "\ndeclare const Worker: number;"
		result, err := backend.Compile(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		requireClean(t, result)
	})
	t.Run("policy spans use authored UTF16 offsets", func(t *testing.T) {
		const source = "// astral 🦀\r\nexport default () => /* 🦀 */ eval('42')"
		result, err := backend.Compile(ctx, nativeTypeScriptRequest(source))
		if err != nil {
			t.Fatal(err)
		}
		for _, diagnostic := range result.Diagnostics {
			if diagnostic.Code != "91001" {
				continue
			}
			start := len(utf16.Encode([]rune(source[:strings.Index(source, "eval")])))
			if diagnostic.File != "turn.ts" || diagnostic.Span == nil || diagnostic.Span.Start != start || diagnostic.Span.Length != 4 {
				t.Fatalf("wrong native policy position: %+v", diagnostic)
			}
			return
		}
		t.Fatal("no policy diagnostic")
	})
	t.Run("validates unknown upstream options", func(t *testing.T) {
		request := nativeTypeScriptRequest(good)
		request.Options["accidentallyMisspelledStrict"] = true
		result, err := backend.Compile(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		requireCode(t, result, "TS5023", "")
		if !result.EmitSkipped || len(result.Artifacts) != 0 {
			t.Fatal("invalid options emitted")
		}
	})
	t.Run("ordinary TypeScript emit options are not cleared by VibeLang lowering", func(t *testing.T) {
		request := nativeTypeScriptRequest(`import { type Functions } from "./types.js"; export default (f: Functions) => f;`)
		request.SourcePolicy = nil
		request.Options["verbatimModuleSyntax"] = true
		request.Files = append(request.Files, SourceFile{Path: "types.ts", Kind: FileKindTypeScript, Text: `export interface Functions {}`})
		result, err := backend.Compile(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		requireClean(t, result)
		if !strings.Contains(artifactTextsByPath(t, result.Artifacts)["turn.js"], `import {} from "./types.js"`) {
			t.Fatal("native verbatimModuleSyntax was silently discarded")
		}
	})
	for _, vector := range []struct {
		name   string
		mutate func(*CompileRequest)
	}{
		{"owns output paths", func(r *CompileRequest) { r.Options["outDir"] = "/outside" }},
		{"no implicit config read", func(r *CompileRequest) { r.ConfigFile = &ConfigFile{Path: "tsconfig.json", Text: "{}"} }},
		{"missing policy file", func(r *CompileRequest) { r.SourcePolicy.Files = []string{"missing.ts"} }},
		{"empty policy files", func(r *CompileRequest) { r.SourcePolicy.Files = nil }},
		{"duplicate normalized policy files", func(r *CompileRequest) { r.SourcePolicy.Files = []string{"turn.ts", "./turn.ts"} }},
		{"duplicate identifiers", func(r *CompileRequest) { r.SourcePolicy.ForbiddenIdentifiers = []string{"eval", "eval"} }},
		{"policy outside TypeScript mode", func(r *CompileRequest) { r.Lowering = LoweringInternal }},
		{"VibeLang source kind", func(r *CompileRequest) { r.Files[0].Kind = FileKindVibeLang }},
		{"mislabeled VibeLang extension", func(r *CompileRequest) { r.Files[0].Path = "turn.vibe"; r.RootNames[0] = "turn.vibe" }},
		{"VibeLang JSX extension", func(r *CompileRequest) { r.Files[0].Path = "turn.VIBEX"; r.RootNames[0] = "turn.VIBEX" }},
		{"internal VibeLang parser extension", func(r *CompileRequest) { r.Files[0].Path = "turn.vibe.ts"; r.RootNames[0] = "turn.vibe.ts" }},
		{"internal VibeLang parser extension casing", func(r *CompileRequest) { r.Files[0].Path = "turn.VIBE.TS"; r.RootNames[0] = "turn.VIBE.TS" }},
		{"normalized VibeLang extension", func(r *CompileRequest) { r.Files[0].Path = "turn.ViBe/."; r.RootNames[0] = "turn.ViBe/." }},
		{"normalized Windows VibeLang JSX extension", func(r *CompileRequest) { r.Files[0].Path = `turn.VIBEX\.`; r.RootNames[0] = `turn.VIBEX\.` }},
	} {
		t.Run(vector.name, func(t *testing.T) {
			request := nativeTypeScriptRequest(good)
			vector.mutate(&request)
			result, err := backend.Compile(ctx, request)
			if err == nil {
				t.Fatalf("invalid boundary request was not refused: %+v", result)
			}
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("refused boundary request emitted")
			}
		})
	}
}
