package compiler

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf16"
)

const schemaImports = `import { comptime } from "vibelang:comptime";
import { Schema } from "vibelang:schema";
`

// Preparation is shared within a table, not compilation state: every request
// still runs a fresh native compiler process. Rebuilding the same executable
// per vector obscures the cost of the checked-type tests themselves.
func newSchemaTestCompiler(t *testing.T) func(*testing.T, []SourceFile, Options) CompileResult {
	t.Helper()
	backend, ctx := newPinnedTestBackend(t)
	return func(t *testing.T, files []SourceFile, options Options) CompileResult {
		t.Helper()
		result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{files[0].Path}, Files: files, Options: options, Lowering: LoweringInternal})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
}

func TestPinnedForkSchemaPrimitiveRoundTrip(t *testing.T) {
	result := compileComptime(t, comptimeSources(schemaImports+`
const Derived = comptime(Schema.derive<string>());
export function main(): string {
    return Derived.parse("native").match({ ok: value => value, error: error => error.pointer });
}
`), nil)
	requireClean(t, result)
	if got := runComptimeProgram(t, result); got != "native" {
		t.Fatalf("got %q", got)
	}
	text := mainText(t, result)
	if strings.Contains(text, "vibelang:schema") || strings.Contains(text, "vibelang:comptime") || strings.Contains(text, "Schema.derive") {
		t.Fatalf("compiler-only edge survived: %s", text)
	}
}

func TestPinnedForkSchemaCheckedTypeDescriptors(t *testing.T) {
	compileComptime := newSchemaTestCompiler(t)
	for _, tc := range []struct{ name, declarations, typ, want string }{
		{"string", "", "string", `{"kind":"string"}`},
		{"number", "", "number", `{"kind":"number"}`},
		{"boolean", "", "boolean", `{"kind":"boolean"}`},
		{"null", "", "null", `{"kind":"null"}`},
		{"literal string", "", `"hello"`, `{"kind":"literal","value":"hello"}`},
		{"literal number", "", "42", `{"kind":"literal","value":42}`},
		{"negative zero", "", "-0", `{"kind":"literal","value":0}`},
		{"true", "", "true", `{"kind":"literal","value":true}`},
		{"false", "", "false", `{"kind":"literal","value":false}`},
		{"union", "", `"a" | "b" | "a"`, `{"kind":"union","variants":[{"kind":"literal","value":"a"},{"kind":"literal","value":"b"}]}`},
		{"nullable", "", "string | null", `{"kind":"union","variants":[{"kind":"null"},{"kind":"string"}]}`},
		{"optional boolean", "", "{ on?: boolean }", `{"kind":"object","properties":[{"name":"on","optional":true,"value":{"kind":"boolean"}}]}`},
		{"readonly array", "", "readonly number[]", `{"kind":"array","element":{"kind":"number"}}`},
		{"tuple", "", "readonly [string, number]", `{"kind":"tuple","elements":[{"kind":"string"},{"kind":"number"}]}`},
		{"empty tuple", "", "[]", `{"kind":"tuple","elements":[]}`},
		{"object", "", "{ z?: number; a: string }", `{"kind":"object","properties":[{"name":"a","optional":false,"value":{"kind":"string"}},{"name":"z","optional":true,"value":{"kind":"number"}}]}`},
		{"interface inheritance", "interface Base { a: string }; interface Child extends Base { z: number }", "Child", `{"kind":"object","properties":[{"name":"a","optional":false,"value":{"kind":"string"}},{"name":"z","optional":false,"value":{"kind":"number"}}]}`},
		{"instantiated alias", "type Box<T> = { value: T };", "Box<string>", `{"kind":"object","properties":[{"name":"value","optional":false,"value":{"kind":"string"}}]}`},
		{"symbol-looking string", "", `{"__@x": string}`, `{"kind":"object","properties":[{"name":"__@x","optional":false,"value":{"kind":"string"}}]}`},
		{"UTF16 field order", "", `{"\uE000": number; "🐈": string}`, `{"kind":"object","properties":[{"name":"🐈","optional":false,"value":{"kind":"string"}},{"name":"","optional":false,"value":{"kind":"number"}}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compileComptime(t, comptimeSources(schemaImports+tc.declarations+`
const Derived = comptime(Schema.derive<`+tc.typ+`>());
export function main(): string { return JSON.stringify(Derived.descriptor); }
`), nil)
			requireClean(t, result)
			if got := runComptimeProgram(t, result); got != tc.want {
				t.Fatalf("descriptor\ngot  %s\nwant %s", got, tc.want)
			}
		})
	}
}

func TestPinnedForkSchemaImportIdentityAndCallForms(t *testing.T) {
	compileComptime := newSchemaTestCompiler(t)
	for _, tc := range []struct{ name, imports, expression string }{
		{"direct", schemaImports, "Schema.derive<string>()"},
		{"alias", `import { comptime } from "vibelang:comptime"; import { Schema as Reify } from "vibelang:schema";`, "Reify.derive<string>()"},
		{"namespace", `import { comptime } from "vibelang:comptime"; import * as Compiler from "vibelang:schema";`, "Compiler.Schema.derive<string>()"},
		{"parenthesized", schemaImports, "((Schema.derive<string>()))"},
		{"satisfies", schemaImports, "(Schema.derive<string>() satisfies unknown)"},
		{"resolved declaration path", `import { comptime } from "./__vibelang_comptime"; import { Schema } from "./__vibelang_schema";`, "Schema.derive<string>()"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compileComptime(t, comptimeSources(tc.imports+`
const Derived = comptime(`+tc.expression+`);
export function main(): string { return Derived.parse("ok").match({ ok: value => value, error: error => error.pointer }); }
`), nil)
			requireClean(t, result)
			if got := runComptimeProgram(t, result); got != "ok" {
				t.Fatalf("got %q", got)
			}
		})
	}
}

func TestPinnedForkSchemaRuntimeValidationAndNativeResultPropagation(t *testing.T) {
	result := compileComptime(t, comptimeSources(schemaImports+`
type Payload = { email: string; tags: string[]; point: [number, number]; meta: { source: string | null; retries?: number } };
const Derived = comptime(Schema.derive<Payload>());
function email(input: unknown) { return Derived.parse(input)!.email; }
export function main(): string {
    const valid = { email: "a@b.c", tags: ["x"], point: [1, 2], meta: { source: null } };
    const answers: string[] = [];
    answers.push(email(valid).match({ ok: value => value, error: error => error.pointer }));
    answers.push(email({ ...valid, tags: ["x", 7] }).match({ ok: value => value, error: error => error.pointer + " " + error.reason }));
    answers.push(email({ ...valid, extra: 1 }).match({ ok: value => value, error: error => error.pointer + " " + error.reason }));
    answers.push(email({ ...valid, point: [1] }).match({ ok: value => value, error: error => error.pointer + " " + error.reason }));
    return answers.join(";");
}
`), nil)
	requireClean(t, result)
	want := "a@b.c;$.tags[1] expected string;$.extra is not declared by the derived type;$.point expected a 2-element tuple but received 1"
	if got := runComptimeProgram(t, result); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestPinnedForkSchemaRejectsEscapesAndMalformedCalls(t *testing.T) {
	compileComptime := newSchemaTestCompiler(t)
	for _, tc := range []struct{ name, source, code string }{
		{"outside", schemaImports + `export const S = Schema.derive<string>();`, "VCT1200"},
		{"nested", schemaImports + `export const S = comptime({ inner: Schema.derive<string>() });`, "VCT1200"},
		{"namespace escape", schemaImports + `export const S = Schema;`, "VCT1200"},
		{"shorthand escape", schemaImports + `export const S = { Schema };`, "VCT1200"},
		{"derive escape", schemaImports + `export const S = Schema.derive;`, "VCT1200"},
		{"module escape", `import * as Compiler from "vibelang:schema"; export const S = Compiler;`, "VCT1200"},
		{"value argument", schemaImports + `export const S = comptime(Schema.derive<string>(1));`, "VCT1201"},
		{"missing type", schemaImports + `export const S = comptime(Schema.derive());`, "VCT1201"},
		{"extra type", schemaImports + `export const S = comptime(Schema.derive<string, number>());`, "VCT1201"},
		{"optional call", schemaImports + `export const S = comptime(Schema.derive?.<string>());`, "VCT1201"},
		{"default import", `import Schema from "vibelang:schema"; export const n = 1;`, "VCT1203"},
		{"type-only import", `import type { Schema } from "vibelang:schema"; export const n = 1;`, "VCT1203"},
		{"unknown export", `import { Other } from "vibelang:schema"; export const n = 1;`, "VCT1203"},
		{"free type parameter", schemaImports + `export function schemaFor<T>() { return comptime(Schema.derive<T>()); }`, "VCT1204"},
		{"reserved nested local", schemaImports + `const S = comptime(Schema.derive<string>()); function f(__vsSchema: number) { return __vsSchema; }`, "VCT1205"},
		{"artifact is not type data", schemaImports + `const S = comptime(Schema.derive<string>()); export type Alias = S;`, "VIBE1913"},
		{"unrelated derive", `import { comptime } from "vibelang:comptime"; const Schema = { derive<T>() { return 1; } }; export const S = comptime(Schema.derive<string>());`, "VCT1202"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compileComptime(t, comptimeSources(tc.source), nil)
			encoded, _ := json.Marshal(result.Diagnostics)
			if !result.EmitSkipped || len(result.Artifacts) != 0 || !strings.Contains(string(encoded), tc.code) {
				t.Fatalf("did not fail closed with %s: %s", tc.code, encoded)
			}
		})
	}
}

func TestPinnedForkSchemaDiagnosticAuthoredUTF16Position(t *testing.T) {
	source := schemaImports + "// 🐈 authored prefix\nexport const S = comptime(Schema.derive<unknown>());"
	result := compileComptime(t, comptimeSources(source), nil)
	want := len(utf16.Encode([]rune(source[:strings.Index(source, "unknown")])))
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Code == "VCT1204" {
			if diagnostic.File != "main.vibe" || diagnostic.Span == nil || diagnostic.Span.Start != want || diagnostic.Span.Length != len("unknown") {
				t.Fatalf("wrong authored span: %+v", diagnostic)
			}
			return
		}
	}
	t.Fatalf("missing unsupported-type diagnostic: %+v", result.Diagnostics)
}

func TestPinnedForkSchemaRefusesUnsupportedCheckedTypes(t *testing.T) {
	compileComptime := newSchemaTestCompiler(t)
	for _, tc := range []struct{ declarations, typ, message string }{
		{"", "any", "any"}, {"", "unknown", "unknown"}, {"", "never", "never"},
		{"", "void", "void"}, {"", "undefined", "undefined"}, {"", "object", "non-primitive"},
		{"", "bigint", "bigint"}, {"", "symbol", "symbol"}, {"", "() => void", "function type"},
		{"", "{ go(): void }", "method"}, {"", "{ handler: () => void }", "function type"},
		{"class Account { id = 1; }", "Account", "class instance"},
		{"", "Record<string, string>", "index signature"},
		{"", "{ a: string } & { b: number }", "intersection"},
		{`enum Level { Low = "low" }`, "Level", "enum"},
		{"type Chain = { next: Chain | null };", "Chain", "recursive"},
		{"", "[number, ...string[]]", "tuple with optional"}, {"", "[number, string?]", "tuple with optional"},
		{"", "{ a: string | undefined }", "undefined"}, {"", "`prefix-${string}`", "unresolved type operator"},
		{"", "new () => object", "constructor type"},
		{"declare const key: unique symbol;", "{ [key]: string }", "symbol-keyed"},
		{"", `"\ud800"`, "unpaired surrogate"}, {"", `{"\ud800": string}`, "unpaired surrogate"},
	} {
		t.Run(tc.typ, func(t *testing.T) {
			result := compileComptime(t, comptimeSources(schemaImports+tc.declarations+`
export const Derived = comptime(Schema.derive<`+tc.typ+`>());
`), nil)
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("unsupported type emitted")
			}
			encoded, _ := json.Marshal(result.Diagnostics)
			if !strings.Contains(string(encoded), "VCT1204") || !strings.Contains(string(encoded), tc.message) {
				t.Fatalf("wrong refusal: %s", encoded)
			}
		})
	}
}

func TestPinnedForkSchemaDerivationBudgets(t *testing.T) {
	compileComptime := newSchemaTestCompiler(t)
	properties := make([]string, 129)
	for index := range properties {
		properties[index] = fmt.Sprintf("p%d: string", index)
	}
	variants := make([]string, 65)
	for index := range variants {
		variants[index] = fmt.Sprintf("%d", index)
	}
	nodes := make([]string, 128)
	for index := range nodes {
		nodes[index] = fmt.Sprintf("p%d: { a: string; b: number; c: boolean; d: null }", index)
	}
	for name, typ := range map[string]string{
		"depth":      strings.Repeat("{ a: ", 18) + "string" + strings.Repeat(" }", 18),
		"properties": "{" + strings.Join(properties, ";") + "}",
		"union":      strings.Join(variants, " | "),
		"tuple":      "[" + strings.Repeat("string,", 64) + "string]",
		"nodes":      "{" + strings.Join(nodes, ";") + "}",
	} {
		t.Run(name, func(t *testing.T) {
			result := compileComptime(t, comptimeSources(schemaImports+`export const Derived = comptime(Schema.derive<`+typ+`>());`), nil)
			encoded, _ := json.Marshal(result.Diagnostics)
			if !result.EmitSkipped || len(result.Artifacts) != 0 || !strings.Contains(string(encoded), "VCT1207") {
				t.Fatalf("budget did not fail closed: %s", encoded)
			}
		})
	}
}

func TestPinnedForkSchemaCrossModuleTypesAndNestedRuntimePath(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { Derived } from "./nested/schema.vibe";
export function main(): string { return Derived.parse({ value: 42 }).match({ ok: value => String(value.value), error: error => error.pointer }); }
`, SourceFile{Path: "nested/schema.vibe", Kind: FileKindVibeLang, Text: schemaImports + `
import type { Payload } from "../types.vibe";
export const Derived = comptime(Schema.derive<Payload>());
`}, SourceFile{Path: "types.vibe", Kind: FileKindVibeLang, Text: "export type Payload = { value: number };"}), Options{"declaration": true, "sourceMap": true})
	requireClean(t, result)
	if got := runComptimeProgram(t, result); got != "42" {
		t.Fatalf("got %q", got)
	}
	artifacts := artifactTextsByPath(t, result.Artifacts)
	if !strings.Contains(artifacts["nested/schema.js"], `"../__vibelang_schema_runtime.js"`) {
		t.Fatalf("wrong nested runtime import: %s", artifacts["nested/schema.js"])
	}
	if !strings.Contains(artifacts["nested/schema.d.vibe.ts"], "Payload") {
		t.Fatalf("declaration lost its checked source type: %s", artifacts["nested/schema.d.vibe.ts"])
	}
	if !strings.Contains(artifacts["nested/schema.js.map"], "schema.vibe") {
		t.Fatalf("missing authored source provenance: %s", artifacts["nested/schema.js.map"])
	}
}

func TestPinnedForkSchemaRuntimeIsDemandEmitted(t *testing.T) {
	result := compileComptime(t, comptimeSources(`export function main(): number { return 42; }`), nil)
	requireClean(t, result)
	for _, artifact := range result.Artifacts {
		if strings.Contains(artifact.Path, "__vibelang_schema") {
			t.Fatalf("unused validator was emitted: %s", artifact.Path)
		}
	}
}

func TestPinnedForkSchemaCannotLeakThroughPlainTypeScript(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { S } from "./plain.js"; export const s = S;`,
		SourceFile{Path: "plain.ts", Kind: FileKindTypeScript, Text: `import { Schema } from "vibelang:schema"; export const S = Schema;`}), nil)
	encoded, _ := json.Marshal(result.Diagnostics)
	if !result.EmitSkipped || len(result.Artifacts) != 0 || !strings.Contains(string(encoded), "VCT1203") {
		t.Fatalf("compiler-only module leaked: %s", encoded)
	}
}
