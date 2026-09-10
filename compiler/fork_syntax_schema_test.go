package compiler

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"reflect"
	"strings"
	"testing"
)

func TestPinnedForkSyntaxSchema(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	deriver := backend.(SyntaxSchemaDeriver)
	for _, tc := range []struct{ name, source, expected string }{
		{"string", "type T = string", `{"kind":"string"}`},
		{"number", "type T = number", `{"kind":"number"}`},
		{"boolean", "type T = boolean", `{"kind":"boolean"}`},
		{"null", "type T = null", `{"kind":"null"}`},
		{"unknown", "type T = unknown", `{"kind":"unknown"}`},
		{"true", "type T = true", `{"kind":"literal","value":true}`},
		{"false", "type T = false", `{"kind":"literal","value":false}`},
		{"literal string", `type T = "hello"`, `{"kind":"literal","value":"hello"}`},
		{"literal numeric", `type T = -42`, `{"kind":"literal","value":-42}`},
		{"negative zero", `type T = -0`, `{"kind":"literal","value":0}`},
		{"hex", `type T = 0x2a`, `{"kind":"literal","value":42}`},
		{"octal", `type T = 0o52`, `{"kind":"literal","value":42}`},
		{"binary", `type T = 0b101010`, `{"kind":"literal","value":42}`},
		{"separators", `type T = 1_000`, `{"kind":"literal","value":1000}`},
		{"array", `type T = string[]`, `{"kind":"array","element":{"kind":"string"}}`},
		{"array reference", `type T = Array<string>`, `{"kind":"array","element":{"kind":"string"}}`},
		{"tuple", `type T = [string, number]`, `{"kind":"tuple","elements":[{"kind":"string"},{"kind":"number"}]}`},
		{"empty tuple", `type T = []`, `{"kind":"tuple","elements":[]}`},
		{"union order", `type T = number | string | null`, `{"kind":"union","variants":[{"kind":"number"},{"kind":"string"},{"kind":"null"}]}`},
		{"interface", `interface T { readonly name: string; count?: number }`, `{"kind":"object","properties":{"name":{"optional":false,"schema":{"kind":"string"}},"count":{"optional":true,"schema":{"kind":"number"}}}}`},
		{"named dependency", `type Value = number; interface T { value: Value }`, `{"kind":"object","properties":{"value":{"optional":false,"schema":{"kind":"number"}}}}`},
		{"escaped reference", `type Value = number; type T = \u0056alue`, `{"kind":"number"}`},
		{"builtin shadow", `type Array = string; type T = Array`, `{"kind":"string"}`},
		{"numeric property", `type T = { 0x2a: string }`, `{"kind":"object","properties":{"42":{"optional":false,"schema":{"kind":"string"}}}}`},
		{"root name shadow in nested namespace", `type T = string; namespace N { type T = number }`, `{"kind":"string"}`},
		{"unrelated executable code is never invoked", `throw new Error("must not run"); type T = number`, `{"kind":"number"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := deriver.SyntaxSchema(ctx, SyntaxSchemaRequest{Source: tc.source, TypeName: "T"})
			if err != nil || !got.OK || got.ParseError || got.Message != "" {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			var actual, expected any
			if err := json.Unmarshal([]byte(got.SchemaJSON), &actual); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(tc.expected), &expected); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("got=%s expected=%s", got.SchemaJSON, tc.expected)
			}
		})
	}
	for _, tc := range []struct{ source, message string }{
		{"", "was not found"}, {`type T = string; type T = number`, "duplicate declaration"},
		{`interface T { a: string; a: number }`, "duplicate property"},
		{`type T = { "a": string; "\u0061": number }`, "duplicate property"},
		{`type T = { 42: string; 0x2a: number }`, "duplicate property"},
		{`type T = { "\ud800": string; "\ud800": number }`, "duplicate property"},
		{`interface T extends A { a: string }`, "interface inheritance"},
		{`type T = { method(): string }`, "only supports property signatures"},
		{`type T = { [key: string]: string }`, "only supports property signatures"},
		{`type T = { ["a"]: string }`, "computed schema property"},
		{`type T = { a }`, "only supports property signatures"},
		{`type T = T[]`, "recursive durable schema"}, {`type U = T; type T = U`, "recursive durable schema"},
		{`type T = 1e400`, "non-finite numeric literal"}, {`type T = -1e400`, "non-finite numeric literal"},
		{`type T = any`, "does not support"}, {`type T = never`, "does not support"},
		{`type T = undefined`, "does not support UndefinedKeyword"}, {`type T = bigint`, "does not support"},
		{`type T = symbol`, "does not support"}, {`type T = 1n`, "does not support"},
		{`type T = (string)`, "does not support"}, {`type T = [label: string]`, "does not support"},
		{`type T = [string?]`, "does not support"}, {`type T = [...string[]]`, "does not support"},
		{`type T = ReadonlyArray<string>`, "cannot resolve"}, {`type T = Record<string, string>`, "cannot resolve"},
		{`interface Array<X> { fake: X }; type T = Array<string>`, "cannot resolve 'X'"},
		{`type X = number; interface T<X> { value: X }`, "cannot resolve 'X'"},
		{`type T<Array> = Array<string>`, "cannot resolve 'Array'"},
		{`import type { Array } from "missing"; type T = Array<string>`, "cannot resolve 'Array'"},
		{`import { Other as Array } from "missing"; type T = Array<string>`, "cannot resolve 'Array'"},
		{`class Array<X> {}; type T = Array<string>`, "cannot resolve 'Array'"},
		{`namespace N { export type Value = string }; type T = N.Value`, "cannot resolve"},
	} {
		t.Run("refuses "+tc.source, func(t *testing.T) {
			got, err := deriver.SyntaxSchema(ctx, SyntaxSchemaRequest{Source: tc.source, TypeName: "T"})
			if err != nil || got.OK || got.ParseError || got.SchemaJSON != "" || !strings.Contains(got.Message, tc.message) {
				t.Fatalf("got=%+v err=%v expected=%s", got, err, tc.message)
			}
		})
	}
	t.Run("parse failure is distinguished without partial schema", func(t *testing.T) {
		got, err := deriver.SyntaxSchema(ctx, SyntaxSchemaRequest{Source: `type T = { a: };`, TypeName: "T"})
		if err != nil || got.OK || !got.ParseError || got.SchemaJSON != "" || !strings.Contains(got.Message, "input did not parse") {
			t.Fatalf("got=%+v err=%v", got, err)
		}
	})
	t.Run("UTF16 data and authored property order survive the process boundary", func(t *testing.T) {
		got, err := deriver.SyntaxSchema(ctx, SyntaxSchemaRequest{Source: `type T = { z: number; "\ud800": "\udfff"; "😀": "\u0000"; "__proto__": string; a: boolean }`, TypeName: "T"})
		if err != nil || !got.OK {
			t.Fatalf("got=%+v err=%v", got, err)
		}
		command := exec.CommandContext(ctx, "node", "--input-type=module", "-e", `import assert from "node:assert/strict"; let text=""; process.stdin.setEncoding("utf8"); for await (const part of process.stdin) text+=part; const schema=JSON.parse(text); assert.deepEqual(Object.keys(schema.properties),["z","\ud800","😀","__proto__","a"]); assert.equal(schema.properties["\ud800"].schema.value,"\udfff"); assert.equal(schema.properties["😀"].schema.value,"\0"); assert(Object.hasOwn(schema.properties,"__proto__")); console.log("exact");`)
		command.Stdin = strings.NewReader(got.SchemaJSON)
		output, err := command.CombinedOutput()
		if err != nil || strings.TrimSpace(string(output)) != "exact" {
			t.Fatalf("output=%q err=%v", output, err)
		}
	})
	t.Run("expansion and depth are bounded", func(t *testing.T) {
		source := "type N0 = number;"
		for index := 1; index <= 15; index++ {
			source += fmt.Sprintf("type N%d = [N%d, N%d];", index, index-1, index-1)
		}
		for _, request := range []SyntaxSchemaRequest{{Source: source, TypeName: "N15"}, {Source: "type T = string" + strings.Repeat("[]", 129), TypeName: "T"}} {
			got, err := deriver.SyntaxSchema(ctx, request)
			if err != nil || got.OK || got.SchemaJSON != "" || !strings.Contains(got.Message, "budget") {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		}
	})
	t.Run("input budgets", func(t *testing.T) {
		for _, request := range []SyntaxSchemaRequest{{Source: strings.Repeat(" ", 2*1024*1024+1), TypeName: "T"}, {Source: "type T=number", TypeName: strings.Repeat("x", 2049)}} {
			if got, err := deriver.SyntaxSchema(ctx, request); err == nil {
				t.Fatalf("unbounded input: %+v", got)
			}
		}
	})
	t.Run("expanded string data cannot return a partial over-budget descriptor", func(t *testing.T) {
		source := `type Text = "` + strings.Repeat("x", 1024*1024) + `"; type T = [Text, Text, Text]`
		got, err := deriver.SyntaxSchema(ctx, SyntaxSchemaRequest{Source: source, TypeName: "T"})
		if err != nil || got.OK || got.SchemaJSON != "" || !strings.Contains(got.Message, "16 MiB budget") {
			t.Fatalf("got=%+v err=%v", got, err)
		}
	})
}
