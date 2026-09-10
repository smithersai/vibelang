package compiler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestPinnedForkDeclarationInspection(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	inspector := backend.(SourceInspector)
	for _, tc := range []struct {
		name, source, kind string
		spellings          []string
	}{
		{"private and exported", `const privateValue=1, other=2; function read(){const nested=3; return nested}; export const exposed=read;`, "typescript", []string{"privateValue", "other", "read", "exposed"}},
		{"overloads and ambient", `declare const declared:number; function read(n:number):number; function read(n:number){return n};`, "typescript", []string{"declared", "read", "read"}},
		{"patterns", `const {value: renamed = 1, ...rest}=input; let [first,,...tail]=input;`, "typescript", []string{"{value: renamed = 1, ...rest}", "[first,,...tail]"}},
		{"nested scopes are not module declarations", `namespace N{export const nested=1}; {let block=1}; for(let loop of []){}; const top=1; class C{method(){let local=1}}`, "typescript", []string{"top"}},
		{"Unicode spelling", "// 🐱\u2028const 𝐁oom=1; function \\u0061(){}", "typescript", []string{"𝐁oom", `\u0061`}},
		{"anonymous default function", `export default function(){return 1}`, "typescript", []string{""}},
		{"ordinary JavaScript", `const f=()=>1; function g(){return f()}`, "javascript", []string{"f", "g"}},
		{"TSX", `const view:unknown=<div/>; function render(){return view}`, "tsx", []string{"view", "render"}},
		{"JSX", `const view=<div/>; function render(){return view}`, "jsx", []string{"view", "render"}},
		{"none", `export {}; class C{}; interface I{}; type T=number; enum E{X}`, "typescript", []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "module.ts", Text: tc.source, ScriptKind: tc.kind, DeclarationBindings: true}}})
			if err != nil || len(got.Files) != 1 || len(got.Files[0].Diagnostics) != 0 || got.Files[0].DeclarationBindings == nil {
				t.Fatalf("%+v %v", got, err)
			}
			actual := []string{}
			units := utf16.Encode([]rune(tc.source))
			for _, binding := range *got.Files[0].DeclarationBindings {
				spelling := ""
				if where := binding.NameSpan; where != nil {
					spelling = string(utf16.Decode(units[where.Start : where.Start+where.Length]))
				}
				if spelling == `\u0061` && (binding.Name == nil || *binding.Name != "a") {
					t.Fatalf("decoded identifier was lost: %+v", binding)
				}
				actual = append(actual, spelling)
			}
			if !reflect.DeepEqual(actual, tc.spellings) {
				t.Fatalf("got %q, want %q", actual, tc.spellings)
			}
		})
	}
	t.Run("opt-in and parser failure", func(t *testing.T) {
		got, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{
			{Path: "plain.ts", Text: "const value=1", ScriptKind: "typescript"},
			{Path: "broken.ts", Text: "const = ;", ScriptKind: "typescript", DeclarationBindings: true},
		}})
		if err != nil || len(got.Files) != 2 || got.Files[0].DeclarationBindings != nil || got.Files[1].DeclarationBindings == nil ||
			len(*got.Files[1].DeclarationBindings) != 0 || len(got.Files[1].Diagnostics) == 0 {
			t.Fatalf("%+v %v", got, err)
		}
	})
	t.Run("JSON has no declarations", func(t *testing.T) {
		_, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "data.json", Text: "{}", ScriptKind: "json", DeclarationBindings: true}}})
		if err == nil || !strings.Contains(err.Error(), "JSON syntax has no declaration bindings") {
			t.Fatal(err)
		}
	})
	t.Run("inventory budget", func(t *testing.T) {
		_, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "many.ts", Text: strings.Repeat("const x=1;", 100_001), ScriptKind: "typescript", DeclarationBindings: true}}})
		if err == nil || !strings.Contains(err.Error(), "100000 entry budget") {
			t.Fatal(err)
		}
	})
}

func TestForkDeclarationInspectionProtocol(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell wire fixture is Unix-only")
	}
	const source = `const x=1; function f(){}`
	valid := func() map[string]any {
		return map[string]any{"path": "source.ts", "diagnostics": []any{}, "moduleSyntax": []any{}, "declarationBindings": []any{
			map[string]any{"kind": "variable", "span": map[string]any{"start": 6, "length": 3}, "name": "x", "nameSpan": map[string]any{"start": 6, "length": 1}},
		}}
	}
	for _, tc := range []struct {
		name      string
		change    func(map[string]any)
		requested bool
		allowed   bool
	}{
		{"valid", nil, true, true},
		{"unrequested", nil, false, false},
		{"missing inventory", func(f map[string]any) { delete(f, "declarationBindings") }, true, false},
		{"null inventory", func(f map[string]any) { f["declarationBindings"] = nil }, true, false},
		{"parse failure cannot claim declarations", func(f map[string]any) {
			f["diagnostics"] = []any{map[string]any{"code": "TS1", "category": "error", "message": "bad syntax", "file": "source.ts"}}
		}, true, false},
		{"missing name", func(f map[string]any) { delete(f["declarationBindings"].([]any)[0].(map[string]any), "name") }, true, false},
		{"missing nameSpan", func(f map[string]any) { delete(f["declarationBindings"].([]any)[0].(map[string]any), "nameSpan") }, true, false},
		{"null kind", func(f map[string]any) { f["declarationBindings"].([]any)[0].(map[string]any)["kind"] = nil }, true, false},
		{"unknown kind", func(f map[string]any) { f["declarationBindings"].([]any)[0].(map[string]any)["kind"] = "symbol" }, true, false},
		{"empty name", func(f map[string]any) { f["declarationBindings"].([]any)[0].(map[string]any)["name"] = "" }, true, false},
		{"out of source", func(f map[string]any) {
			f["declarationBindings"].([]any)[0].(map[string]any)["span"] = map[string]any{"start": 0, "length": 1000}
		}, true, false},
		{"missing span start", func(f map[string]any) {
			f["declarationBindings"].([]any)[0].(map[string]any)["span"] = map[string]any{"length": 1}
		}, true, false},
		{"name outside declaration", func(f map[string]any) {
			f["declarationBindings"].([]any)[0].(map[string]any)["nameSpan"] = map[string]any{"start": 0, "length": 1}
		}, true, false},
		{"nameless variable", func(f map[string]any) { f["declarationBindings"].([]any)[0].(map[string]any)["nameSpan"] = nil }, true, false},
		{"repeated declaration", func(f map[string]any) {
			f["declarationBindings"] = append(f["declarationBindings"].([]any), f["declarationBindings"].([]any)[0])
		}, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			file := valid()
			if tc.change != nil {
				tc.change(file)
			}
			encoded, err := json.Marshal(map[string]any{"apiVersion": APIVersion, "compilerRevision": PinnedTypeScriptRevision, "result": map[string]any{"files": []any{file}}})
			if err != nil {
				t.Fatal(err)
			}
			executable := filepath.Join(t.TempDir(), "bridge")
			if err := os.WriteFile(executable, []byte(fmt.Sprintf("#!/bin/sh\nprintf '%%s' '%s'\n", encoded)), 0o755); err != nil {
				t.Fatal(err)
			}
			_, err = (&forkCompiler{executable: executable}).Inspect(context.Background(), InspectionRequest{Files: []InspectionSource{{Path: "source.ts", Text: source, ScriptKind: "typescript", DeclarationBindings: tc.requested}}})
			if tc.allowed && err != nil || !tc.allowed && !errors.Is(err, ErrForkProtocol) {
				t.Fatalf("allowed=%v err=%v", tc.allowed, err)
			}
		})
	}
}
