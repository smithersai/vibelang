package compiler

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestPinnedForkAssetImportDiscovery(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(AssetImportsAnalyzer)
	for _, tc := range []struct{ name, source, form, specifier string }{
		{"default", `import data from "./data.json" with {type:"json"};`, "import", "./data.json"},
		{"namespace", `import * as data from "./data.json" with {type:"json"};`, "import", "./data.json"},
		{"mixed type binding", `import {type X, default as data} from "./data.json" with {type:"json"};`, "import", "./data.json"},
		{"named re-export", `export {default as data} from "./data.json" with {type:"json"};`, "re-export", "./data.json"},
		{"namespace re-export", `export * as data from "./data.json" with {type:"json"};`, "re-export", "./data.json"},
		{"dynamic", `export const data = import("./data.json", {with:{type:"json"}});`, "dynamic-import", "./data.json"},
		{"template specifier", "export const data = import(`./data.json`, {with:{type:'json'}});", "dynamic-import", "./data.json"},
		{"attributed code", `import data from "./data.ts" with {type:"text"};`, "import", "./data.ts"},
		{"uninvoked callback", `function later() { return import("./data.json", {with:{type:"json"}}); }`, "dynamic-import", "./data.json"},
		{"conditional declaration", `if (const x = 1; x) { const data = import("./data.json", {with:{type:"json"}}); }`, "dynamic-import", "./data.json"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := analyzer.AssetImports(ctx, AssetImportsRequest{Files: []AssetImportSource{{Path: "main.vibe", Text: tc.source}}})
			if err != nil || len(got.Files) != 1 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			file := got.Files[0]
			if len(file.Diagnostics) != 0 || len(file.Requests) != 1 || len(file.OrdinaryImports) != 0 {
				t.Fatalf("got=%+v", file)
			}
			request := file.Requests[0]
			if request.Form != tc.form || request.Specifier != tc.specifier || request.Attributes["type"] == "" || request.SpecifierSite.Start <= request.Site.Start {
				t.Fatalf("request=%+v", request)
			}
		})
	}
	for _, newline := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029"} {
		t.Run("authored positions "+newline, func(t *testing.T) {
			source := "if (const x = 1; x) {}" + newline + `/* 🐱 */ import data from "./data.json" with {type:"json"};`
			got, err := analyzer.AssetImports(ctx, AssetImportsRequest{Files: []AssetImportSource{{Path: "src/猫.vibe", Text: source}}})
			if err != nil || len(got.Files) != 1 || len(got.Files[0].Requests) != 1 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			request := got.Files[0].Requests[0]
			start := len(utf16.Encode([]rune(source[:strings.Index(source, "import data")])))
			if request.Site != (AssetImportPosition{Start: start, Line: 2, Column: 10}) || request.SpecifierSite.Line != 2 || request.SpecifierSite.Column != 27 {
				t.Fatalf("request=%+v", request)
			}
		})
	}
	got, err := analyzer.AssetImports(ctx, AssetImportsRequest{Files: []AssetImportSource{{Path: "main.ts", Text: `
import type {X} from "./types";
export {x} from "./helper.js";
import helper = require("./helper.js");
const data = import("./nested");
const arbitrary = import(name);
`}}})
	if err != nil || len(got.Files) != 1 || len(got.Files[0].Diagnostics) != 0 || len(got.Files[0].OrdinaryImports) != 3 {
		t.Fatalf("got=%+v err=%v", got, err)
	}
	for _, item := range got.Files[0].OrdinaryImports {
		if item.ResolvedPath != "" {
			t.Fatalf("resolved without a root: %+v", item)
		}
	}
}

func TestPinnedForkAssetPreflightConditionalDeclarationDiagnostics(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(AssetImportsAnalyzer)
	for _, tc := range []struct{ name, statement, refusal string }{
		{"var", `if (var x = 1; x) { return x; }`, "`var`"},
		{"braceless then", `if (const x = 1; x) return x;`, "braced branches"},
		{"braceless else", `if (const x = 1; x) { return x; } else return 0;`, "braced branches"},
		{"braceless else-if", `if (const x = 1; x) { return x; } else if (true) return 0;`, "braced branches"},
		{"two separators", `if (const x = 1; x; true) { return x; }`, "exactly one `;`"},
		{"no declaration", `if (1; true) { return 1; }`, "must begin with `const` or `let`"},
		{"empty condition", `if (const x = 1; ) { return x; }`, "both a declaration and a condition"},
		{"const", `if (const x = 1; x) { return x; }`, ""},
		{"let", `if (let x = 1; x) { return x; } else { return 0; }`, ""},
	} {
		for _, newline := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029"} {
			t.Run(tc.name+newline, func(t *testing.T) {
				const file = "conditional.vibe"
				source := "// 🦀" + newline + "export function read(): number {" + newline + "  " + tc.statement + " return 0; }"
				got, err := analyzer.AssetImports(ctx, AssetImportsRequest{Files: []AssetImportSource{{Path: file, Text: source}}})
				if err != nil || len(got.Files) != 1 {
					t.Fatalf("got=%+v err=%v", got, err)
				}
				if tc.refusal == "" {
					if len(got.Files[0].Diagnostics) != 0 {
						t.Fatalf("valid form refused: %+v", got)
					}
					return
				}
				diagnostics := got.Files[0].Diagnostics
				if len(diagnostics) != 1 || diagnostics[0].Code != "VIBE1717" || diagnostics[0].Line != 3 || diagnostics[0].Column != 3 ||
					!strings.Contains(diagnostics[0].Message, tc.refusal) || len(got.Files[0].Requests) != 0 || len(got.Files[0].OrdinaryImports) != 0 {
					t.Fatalf("wrong early refusal: %+v", got)
				}
				checked, err := backend.Compile(ctx, CompileRequest{RootNames: []string{file}, Files: []SourceFile{{Path: file, Kind: FileKindVibeLang, Text: source}}, Lowering: LoweringInternal})
				if err != nil {
					t.Fatal(err)
				}
				requireCode(t, checked, "VIBE1717", "")
				for _, diagnostic := range checked.Diagnostics {
					if diagnostic.Code == "VIBE1717" && diagnostic.Message != diagnostics[0].Message {
						t.Fatalf("preflight and lowering disagreed: %+v vs %+v", diagnostics, checked.Diagnostics)
					}
				}
			})
		}
	}
}

func TestPinnedForkAssetImportRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(AssetImportsAnalyzer)
	for _, tc := range []struct{ name, source, code string }{
		{"missing type", `import data from "./data.json";`, "VIBE5201"},
		{"legacy assertion", `import data from "./data.json" assert {type:"json"};`, "VIBE5202"},
		{"legacy re-export assertion", `export {default as data} from "./data.json" assert {type:"json"};`, "VIBE5202"},
		{"attribute name", `import data from "./data.json" with {"bad name":"json"};`, "VIBE5201,VIBE5203"},
		{"attribute duplicate", `import data from "./data.json" with {type:"json",type:"text"};`, "VIBE5204"},
		{"attribute value", `import data from "./data.json" with {type:kind};`, "VIBE5201,VIBE5205"},
		{"template attribute value", "import data from './data.json' with {type:`json`};", "VIBE5201,VIBE5205"},
		{"star export", `export * from "./data.json" with {type:"json"};`, "VIBE5206"},
		{"bare attributed", `import data from "data" with {type:"json"};`, "VIBE5207"},
		{"type only", `import type data from "./data.json" with {type:"json"};`, "VIBE5208"},
		{"named type only", `import {type X} from "./data.json" with {type:"json"};`, "VIBE5208"},
		{"side effect", `import "./data.json" with {type:"json"};`, "VIBE5208"},
		{"empty import", `import {} from "./data.json" with {type:"json"};`, "VIBE5208"},
		{"empty export", `export {} from "./data.json" with {type:"json"};`, "VIBE5208"},
		{"type export", `export {type X} from "./data.json" with {type:"json"};`, "VIBE5208"},
		{"type query", `type X = import("./data.json");`, "VIBE5208"},
		{"dynamic computed", `const data = import(name, {with:{type:"json"}});`, "VIBE5218"},
		{"dynamic options", `const data = import("./data.json", options);`, "VIBE5218"},
		{"dynamic spreads", `const data = import("./data.json", {with:{...options}});`, "VIBE5218"},
		{"dynamic extra argument", `const data = import("./data.json", {with:{type:"json"}}, 1);`, "VIBE5218"},
		{"dynamic duplicate", `const data = import("./data.json", {with:{type:"json",type:"text"}});`, "VIBE5204"},
		{"dynamic value", `const data = import("./data.json", {with:{type:kind}});`, "VIBE5205"},
		{"assignment", `import data = require("./data.json");`, "VIBE5201"},
		{"assignment nonliteral", `import data = require(name);`, "VIBE5205"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, name := range []string{"main.ts", "main.vibe"} {
				got, err := analyzer.AssetImports(ctx, AssetImportsRequest{Files: []AssetImportSource{{Path: name, Text: tc.source}}})
				if err != nil || len(got.Files) != 1 {
					t.Fatalf("got=%+v err=%v", got, err)
				}
				file := got.Files[0]
				codes := make([]string, 0, len(file.Diagnostics))
				for _, diagnostic := range file.Diagnostics {
					codes = append(codes, diagnostic.Code)
				}
				if strings.Join(codes, ",") != tc.code || len(file.Requests) != 0 || len(file.OrdinaryImports) != 0 {
					t.Fatalf("%s: %+v", name, file)
				}
			}
		})
	}
	for _, tc := range []struct{ name, source, code string }{
		{"main.ts", `const = ;`, "TS1134"},
		{"main.vibe", `const = ;`, "VIBE1000"},
		{"retired.vibe", `const x = if (true) 1 else 2;`, "VIBE1001"},
	} {
		t.Run("grammar "+tc.name, func(t *testing.T) {
			got, err := analyzer.AssetImports(ctx, AssetImportsRequest{Files: []AssetImportSource{{Path: tc.name, Text: tc.source}}})
			if err != nil || len(got.Files) != 1 || len(got.Files[0].Diagnostics) == 0 || got.Files[0].Diagnostics[0].Code != tc.code {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
}

func TestPinnedForkAssetImportNativeResolution(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(AssetImportsAnalyzer)
	root := t.TempDir()
	for name, text := range map[string]string{
		"helper.ts": "throw new Error('must not execute')", "feature.mts": "", "screen.tsx": "", "local.vibe": "", "nested/index.ts": "",
		"pkg/package.json": `{"types":"./types.d.ts","main":"./runtime.js"}`, "pkg/types.d.ts": "", "pkg/runtime.js": "",
		"escape/package.json": `{"types":"../../outside.d.ts"}`,
	} {
		file := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct{ specifier, resolved string }{
		{"./helper", "helper.ts"}, {"./helper.js", "helper.ts"}, {"./feature.mjs", "feature.mts"}, {"./screen", "screen.tsx"},
		{"./local.vibe", "local.vibe"}, {"./nested", "nested/index.ts"}, {"./pkg", "pkg/types.d.ts"}, {"./missing", ""}, {"../outside", ""}, {"./escape", ""},
	} {
		t.Run(tc.specifier, func(t *testing.T) {
			got, err := analyzer.AssetImports(ctx, AssetImportsRequest{ResolutionRoot: root, Files: []AssetImportSource{{Path: "main.vibe", Text: `import {x} from "` + tc.specifier + `";`}}})
			if err != nil || len(got.Files) != 1 || len(got.Files[0].OrdinaryImports) != 1 || got.Files[0].OrdinaryImports[0].ResolvedPath != tc.resolved {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	if err := os.Symlink("helper.ts", filepath.Join(root, "alias.ts")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("nested", filepath.Join(root, "alias-dir")); err != nil {
		t.Fatal(err)
	}
	for _, specifier := range []string{"./alias", "./alias-dir"} {
		got, err := analyzer.AssetImports(ctx, AssetImportsRequest{ResolutionRoot: root, Files: []AssetImportSource{{Path: "main.ts", Text: `import {x} from "` + specifier + `";`}}})
		if err != nil || len(got.Files) != 1 || len(got.Files[0].OrdinaryImports) != 1 || got.Files[0].OrdinaryImports[0].ResolvedPath != "" {
			t.Fatalf("got=%+v err=%v", got, err)
		}
	}
}

func TestPinnedForkAssetImportRequestValidation(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(AssetImportsAnalyzer)
	for _, request := range []AssetImportsRequest{
		{Files: []AssetImportSource{{Path: "main\x00.ts"}}},
		{Files: []AssetImportSource{{Path: "../outside.ts"}}},
		{Files: []AssetImportSource{{Path: "main.ts"}, {Path: "./main.ts"}}},
		{ResolutionRoot: "relative", Files: []AssetImportSource{{Path: "main.ts"}}},
		{Files: []AssetImportSource{{Path: "main.ts", Text: `import x from "./\ud800.ts";`}}},
		{Files: []AssetImportSource{{Path: "main.ts", Text: `import x from "./\0.ts";`}}},
		{Files: []AssetImportSource{{Path: "main.ts", Text: `import x from "./data.json" with {type:"json",note:"\ud800"};`}}},
		{Files: make([]AssetImportSource, 4097)},
	} {
		if _, err := analyzer.AssetImports(ctx, request); err == nil {
			t.Fatalf("accepted invalid request: %+v", request)
		}
	}
	got, err := analyzer.AssetImports(ctx, AssetImportsRequest{Files: []AssetImportSource{}})
	if err != nil || got.Files == nil || len(got.Files) != 0 {
		t.Fatalf("empty request: %+v %v", got, err)
	}
}

func TestPinnedForkAssetImportMetadataBudget(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(AssetImportsAnalyzer)
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pkg", "package.json"), []byte(strings.Repeat(" ", 1024*1024+1)), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := analyzer.AssetImports(ctx, AssetImportsRequest{ResolutionRoot: root, Files: []AssetImportSource{{Path: "main.ts", Text: `import {x} from "./pkg";`}}})
	if err == nil || !strings.Contains(err.Error(), "metadata budget") {
		t.Fatalf("oversize package metadata did not fail closed: %v", err)
	}
}
