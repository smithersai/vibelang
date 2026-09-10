package compiler

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestPinnedForkCheckedSchemas(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	deriver := backend.(CheckedSchemasDeriver)
	query := func(file, source, call string) CheckedSchemaQuery {
		t.Helper()
		start := strings.Index(source, call)
		if start < 0 {
			t.Fatal("missing query")
		}
		return CheckedSchemaQuery{File: file, Span: Span{Start: len(utf16.Encode([]rune(source[:start]))), Length: len(utf16.Encode([]rune(call)))}}
	}
	for _, tc := range []struct{ name, decl, typ, kind string }{
		{"primitive", "", "number", "number"},
		{"alias", "type Item={a?:string,b:readonly [number,string]}", "Item", "object"},
		{"resolved mapped", "type A={x:number}; type B={readonly [P in keyof A]: A[P]}", "B", "object"},
		{"array", "", "readonly number[]", "array"},
		{"union", "", "string | null", "union"},
		{"boolean", "", "boolean", "boolean"},
		{"unicode", `type T = {"😀": "🐱", "__@x": 1}`, "T", "object"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			call := "derive<" + tc.typ + ">()"
			source := "// 🦀\n" + tc.decl + "; const value=" + call
			got, err := deriver.CheckedSchemas(ctx, CheckedSchemasRequest{Files: []InspectionSource{{Path: "main.ts", Text: source, ScriptKind: "typescript"}},
				Modules: map[string]string{}, Queries: []CheckedSchemaQuery{query("main.ts", source, call)}})
			if err != nil || len(got.Schemas) != 1 || !got.Schemas[0].OK {
				t.Fatalf("%+v %v", got, err)
			}
			var descriptor struct{ Kind string }
			if err := json.Unmarshal([]byte(got.Schemas[0].SchemaJSON), &descriptor); err != nil || descriptor.Kind != tc.kind {
				t.Fatal(got)
			}
		})
	}
	t.Run("one native program resolves imports and lexical shadows without evaluating initializers", func(t *testing.T) {
		const source = `import type {Item} from "./types.vibe"; import type {Other} from "virtual:types";
const a=derive<Item>(); function local(){type Item=boolean;return derive<Item>()}
const b=derive<Other>(); globalThis.process.exit(19);`
		// Queries deliberately arrive in a different order than source order.
		second := strings.LastIndex(source, "derive<Item>()")
		got, err := deriver.CheckedSchemas(ctx, CheckedSchemasRequest{
			Files: []InspectionSource{{Path: "main.vibe", Text: source, ScriptKind: "typescript"},
				{Path: "types.vibe", Text: `export type Item={count:number}`, ScriptKind: "typescript"},
				{Path: "lib.ts", Text: `export type Other=string`, ScriptKind: "typescript"}},
			Modules: map[string]string{"virtual:types": "lib.ts"},
			Queries: []CheckedSchemaQuery{query("main.vibe", source, "derive<Other>()"), {File: "main.vibe", Span: Span{Start: second, Length: len("derive<Item>()")}}, query("main.vibe", source, "derive<Item>()")},
		})
		if err != nil || len(got.Schemas) != 3 {
			t.Fatalf("%+v %v", got, err)
		}
		for i, kind := range []string{"string", "boolean", "object"} {
			if !got.Schemas[i].OK || !strings.Contains(got.Schemas[i].SchemaJSON, `"kind":"`+kind+`"`) {
				t.Fatal(got)
			}
		}
	})
	t.Run("script kinds retain native JS inference and TSX parsing", func(t *testing.T) {
		for _, tc := range []struct{ kind, file, source string }{
			{"tsx", "main.tsx", `const el=<div/>; const value=derive<number>();`},
			{"typescript", "main.ts", `import {value} from "./data.js"; const item=derive<typeof value>();`},
		} {
			got, err := deriver.CheckedSchemas(ctx, CheckedSchemasRequest{Files: []InspectionSource{
				{Path: tc.file, Text: tc.source, ScriptKind: tc.kind},
				{Path: "data.js", Text: `/** @type {number} */ export let value=1;`, ScriptKind: "javascript"}},
				Modules: map[string]string{}, Queries: []CheckedSchemaQuery{query(tc.file, tc.source, tc.source[strings.Index(tc.source, "derive<"):strings.Index(tc.source, "();")+2])}})
			if err != nil || !got.Schemas[0].OK || got.Schemas[0].SchemaJSON != `{"kind":"number"}` {
				t.Fatalf("%+v %v", got, err)
			}
		}
	})
	for _, tc := range []struct{ decl, typ, message string }{
		{"", "any", "any"}, {"", "unknown", "unknown"}, {"", "never", "never"}, {"", "undefined", "undefined"},
		{"type T={next?:T}", "T", "recursive"}, {"class T{value=1}", "T", "class instance"},
		{"", "()=>number", "function"}, {"", "[number?]", "optional"}, {"", `"\ud800"`, "surrogate"},
		{"import type {Missing} from 'unavailable'", "Missing", "any"},
	} {
		t.Run("refuse "+tc.typ+tc.decl, func(t *testing.T) {
			call := "derive<" + tc.typ + ">()"
			source := tc.decl + "; " + call
			got, err := deriver.CheckedSchemas(ctx, CheckedSchemasRequest{Files: []InspectionSource{{Path: "main.ts", Text: source, ScriptKind: "typescript"}}, Modules: map[string]string{}, Queries: []CheckedSchemaQuery{query("main.ts", source, call)}})
			if err != nil || got.Schemas[0].OK || got.Schemas[0].Failure != "unsupported" || !strings.Contains(got.Schemas[0].Message, tc.message) {
				t.Fatalf("%+v %v", got, err)
			}
		})
	}
	t.Run("per-query budgets and output expansion fail as reification diagnostics", func(t *testing.T) {
		properties := []string{}
		for _, name := range []string{"a", "b", "c", "d", "e", "f", "g", "h"} {
			properties = append(properties, name+":Atom")
		}
		for _, shape := range []string{
			"[" + strings.Repeat("number,", 64) + "number]",
			strings.Repeat("{a:", 18) + "number" + strings.Repeat("}", 18),
			"{" + strings.Join(properties, ";") + "}",
		} {
			source := `type Atom="` + strings.Repeat("a", 300_000) + `"; type T=` + shape + `; derive<T>(); derive<number>()`
			got, err := deriver.CheckedSchemas(ctx, CheckedSchemasRequest{Files: []InspectionSource{{Path: "main.ts", Text: source, ScriptKind: "typescript"}}, Modules: map[string]string{},
				Queries: []CheckedSchemaQuery{query("main.ts", source, "derive<T>()"), query("main.ts", source, "derive<number>()")}})
			if err != nil || len(got.Schemas) != 2 || got.Schemas[0].OK || got.Schemas[0].Failure != "budget" || !got.Schemas[1].OK {
				t.Fatalf("budget: %+v %v", got, err)
			}
		}
	})
	t.Run("invalid selections and sources never return partial schemas", func(t *testing.T) {
		base := CheckedSchemasRequest{Files: []InspectionSource{{Path: "main.ts", Text: "derive<number>()", ScriptKind: "typescript"}}, Modules: map[string]string{}, Queries: []CheckedSchemaQuery{{File: "main.ts", Span: Span{Start: 0, Length: 16}}}}
		for _, change := range []func(*CheckedSchemasRequest){
			func(r *CheckedSchemasRequest) { r.Queries[0].Span.Start = 1 },
			func(r *CheckedSchemasRequest) { r.Queries[0].Span.Length = 15 },
			func(r *CheckedSchemasRequest) { r.Queries[0].File = "missing.ts" },
			func(r *CheckedSchemasRequest) { r.Files[0].Path = "../escape.ts" },
			func(r *CheckedSchemasRequest) { r.Files[0].Path = "main\x00.ts" },
			func(r *CheckedSchemasRequest) { r.Files[0].ScriptKind = "json" },
			func(r *CheckedSchemasRequest) { r.Modules = map[string]string{"*": "main.ts"} },
			func(r *CheckedSchemasRequest) { r.Modules = map[string]string{"missing": "absent.ts"} },
			func(r *CheckedSchemasRequest) { r.Files = append(r.Files, r.Files[0]) },
		} {
			r := base
			r.Files = append([]InspectionSource(nil), base.Files...)
			r.Queries = append([]CheckedSchemaQuery(nil), base.Queries...)
			change(&r)
			if _, err := deriver.CheckedSchemas(ctx, r); err == nil {
				t.Fatal("invalid query accepted")
			}
		}
	})
}
