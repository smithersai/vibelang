package compiler

import (
	"fmt"
	"strings"
	"testing"
)

func TestPinnedForkLanguageAnalysisRuntimeAliases(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(LanguageAnalyzer)
	const data = "/** @module @throws {never} */\nconst value={count:3,mode:'const'} as const;export default value;export const label='asset';"
	input := func(source, runtime string, owned bool) LanguageAnalysisRequest {
		return LanguageAnalysisRequest{ExplicitVibeLangSources: true,
			Files:          []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}, {Path: "generated/config.ts", Kind: FileKindTypeScript, Text: runtime}},
			RuntimeModules: []LanguageAnalysisRuntimeModule{{Path: "generated/config.ts", Aliases: []string{"config.json", "nested/config.json", "alias.ts"}, CompilerData: owned}}}
	}
	for _, source := range []string{
		`import config from './config.json' with {type:'json',mode:'const'};export function main(){return config.count}`,
		`import * as config from './nested/config.json' with {type:'json'};export function main(){return config.default.count+config.label.length}`,
		`import config from './alias.ts';export function main(){return config.count}`,
		`import config from './generated/config.ts';export function main(){return config.count}`,
		`export async function main(){const config=await import('./config.json',{with:{type:'json'}});return config.default.count}`,
		`export {default as config,label} from './config.json' with {type:'json'};`,
	} {
		got, err := analyzer.AnalyzeLanguage(ctx, input(source, data, true))
		if err != nil || !got.Checked || len(got.Files) != 1 || got.Files[0].Path != "main.vibe" {
			t.Fatalf("%s: %+v %v", source, got, err)
		}
	}
	t.Run("all aliases refer to the same nominal export", func(t *testing.T) {
		request := input(`import type {Box as A} from './alias.ts';import type {Box as B} from './generated/config.ts';export function identity(value:A):B{return value}`,
			`export class Box {private value=1}`, false)
		got, err := analyzer.AnalyzeLanguage(ctx, request)
		if err != nil || !got.Checked {
			t.Fatalf("duplicated nominal declaration: %+v %v", got, err)
		}
	})
	t.Run("named-only exports do not invent default exports", func(t *testing.T) {
		got, err := analyzer.AnalyzeLanguage(ctx, input(`import {label} from './alias.ts';export function main(){return label}`,
			"/** @module @throws {never} */\nexport const label='asset';", true))
		if err != nil || !got.Checked {
			t.Fatalf("named-only alias: %+v %v", got, err)
		}
	})
	for _, tc := range []struct{ name, source, runtime, code string }{
		{"forged data marker", `import config from './config.json' with {type:'json'};export function main(){return config.count}`, data, "VIBE1506"},
		{"untrusted initializer", `import config from './config.json' with {type:'json'};export const value=config`, `const config={count:3};export default config;`, "VIBE1510"},
		{"dynamic untrusted initializer", `export async function main(){const config=await import('./config.json',{with:{type:'json'}});return config.default}`, `const config={count:3};export default config;`, "VIBE1510"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := analyzer.AnalyzeLanguage(ctx, input(tc.source, tc.runtime, false))
			found := false
			for _, issue := range got.Diagnostics {
				found = found || issue.Code == tc.code
			}
			if err != nil || got.Checked || !found {
				t.Fatalf("lost foreign refusal: %+v %v", got, err)
			}
		})
	}
	t.Run("readonly inferred data types survive aliases", func(t *testing.T) {
		got, err := analyzer.AnalyzeLanguage(ctx, input(`import config from './config.json' with {type:'json'};export function main(){config.count=4}`, data, true))
		found := false
		for _, issue := range got.Diagnostics {
			found = found || issue.Code == "TS2540"
		}
		if err != nil || got.Checked || !found {
			t.Fatalf("erased readonly type: %+v %v", got, err)
		}
	})
	for _, runtime := range []string{
		"/** @module @throws {never} */\nexport const bad=(()=>42)()",
		"/** @module @throws {never} */\nexport const bad=42 as unknown as (()=>number)",
		"/** @module @throws {never} */\nexport const bad:any=42",
		"/// <reference path='./ambient.d.ts'/>\n/** @module @throws {never} */\nexport const bad=42",
		"/** @module @throws {never} */\nexport const bad=new Map()",
		"export const bad=42",
	} {
		if got, err := analyzer.AnalyzeLanguage(ctx, input(`export {}`, runtime, true)); err == nil {
			t.Fatalf("admitted forged compiler data %s: %+v", runtime, got)
		}
	}
	for _, aliases := range [][]string{
		{"generated/config.ts"}, {"../escape.ts"}, {"main.vibe"}, {"config.ts", "config.js"}, {"config.json", "config.d.json.ts"}, {"bad\x00.ts"}, {strings.Repeat("x", 16*1024+1)},
	} {
		request := input(`export {}`, data, true)
		request.RuntimeModules[0].Aliases = aliases
		if got, err := analyzer.AnalyzeLanguage(ctx, request); err == nil {
			t.Fatalf("accepted invalid aliases %q: %+v", aliases, got)
		}
	}
}

func TestPinnedForkLanguageAnalysisRuntimeDataGraph(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(LanguageAnalyzer)
	const head = "/** @module @throws {never} */\n"
	parent, child := strings.Repeat("a", 64), strings.Repeat("b", 64)
	input := LanguageAnalysisRequest{Files: []SourceFile{
		{Path: "main.vibe", Kind: FileKindVibeLang, Text: `import config from './config.json' with {type:'custom'};export function main(){return config.child.count}`},
		{Path: "generated/" + parent + ".ts", Kind: FileKindTypeScript, Text: head + `import child from './` + child + `.ts';const value={child:child};export default value;`},
		{Path: "generated/" + child + ".ts", Kind: FileKindTypeScript, Text: head + `const value={count:42} as const;export default value;`},
	}, RuntimeModules: []LanguageAnalysisRuntimeModule{
		{Path: "generated/" + parent + ".ts", Aliases: []string{"config.json"}, CompilerData: true},
		{Path: "generated/" + child + ".ts", Aliases: []string{}, CompilerData: true},
	}}
	if result, err := analyzer.AnalyzeLanguage(ctx, input); err != nil || !result.Checked {
		t.Fatalf("closed data graph: %+v %v", result, err)
	}
	input.RuntimeModules[1].CompilerData = false
	if result, err := analyzer.AnalyzeLanguage(ctx, input); err == nil {
		t.Fatalf("data provenance laundered an unissued dependency: %+v", result)
	}
	input.RuntimeModules[1].CompilerData = true
	input.Files[2].Text = head + `import parent from './` + parent + `.ts';const value={parent:parent};export default value;`
	if result, err := analyzer.AnalyzeLanguage(ctx, input); err == nil || !strings.Contains(err.Error(), "cyclic") {
		t.Fatalf("data dependency cycle: %+v %v", result, err)
	}
	// A shared tail must count toward every path's length, even after visiting
	// it from a shallower root. Admission computes graph height, not a visited
	// boolean that could silently skip the tail at a later, deeper entry.
	input = LanguageAnalysisRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export {}`}}}
	for index := 0; index < 129; index++ {
		key := fmt.Sprintf("%064x", index)
		text := head + `export const value=42;`
		if index != 0 {
			text = head + `import {value as prior} from './` + fmt.Sprintf("%064x", index-1) + `.ts';export const value=prior;`
		}
		input.Files = append(input.Files, SourceFile{Path: "generated/" + key + ".ts", Kind: FileKindTypeScript, Text: text})
		input.RuntimeModules = append(input.RuntimeModules, LanguageAnalysisRuntimeModule{Path: "generated/" + key + ".ts", Aliases: []string{}, CompilerData: true})
	}
	if result, err := analyzer.AnalyzeLanguage(ctx, input); err == nil || !strings.Contains(err.Error(), "128 levels") {
		t.Fatalf("data graph depth was lost through memoization: %+v %v", result, err)
	}
}
