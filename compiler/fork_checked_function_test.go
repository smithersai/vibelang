package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPinnedForkCheckedFunction(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	inspector := backend.(CheckedFunctionInspector)
	for _, tc := range []struct {
		name, source, export, failure, requirement string
		panic                                      bool
	}{
		{name: "plain", source: `export function work(n: number) { return n + 1; }`},
		{name: "empty Result", source: `export function work(n: number): Result<number, never> { return n + 1; }`},
		{name: "arrow", source: `export const work = (n: number) => n + 1;`},
		{name: "export alias", source: `function local(n: number) { return n + 1; } export { local as work };`},
		{name: "async", source: `export async function work(n: number): Promise<number> { return n + 1; }`},
		{name: "unicode span", source: `// 😀
export function 計算(入力: number) { return 入力 + 1; }`, export: "計算"},
		{name: "typed Error", source: `class Failed extends Error { constructor(readonly code: string) { super(code); } }
export function work(n: number): Result<number, Failed> { if (n < 0) throw new Failed("negative"); return n + 1; }`, failure: "Failed"},
		{name: "native Error", source: `export function work(n: number): Result<number, Error> { if (n < 0) throw new Error("negative"); return n + 1; }`, failure: "Error"},
		{name: "Panic is separate", source: `import { Panic, panic } from "vibelang:exceptions";
class Failed extends Error {}
export function work(n: number): Result<number, Failed | Panic> { if (n < 0) throw new Failed("negative"); if (n === 0) panic("zero"); return n; }`, failure: "Failed", panic: true},
		{name: "transitive capability", source: `import { Context } from "vibelang/context";
abstract class Database extends Context { abstract read(n: number): number; }
function helper(n: number) { return Database.context().read(n); }
export function work(n: number) { return helper(n); }`, requirement: "Database"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			export := tc.export
			if export == "" {
				export = "work"
			}
			request := CheckedFunctionRequest{Files: []SourceFile{{Path: "functions.vibe", Kind: FileKindVibeLang, Text: tc.source}}, EntryFile: "functions.vibe", ExportName: export}
			got, err := inspector.CheckedFunction(ctx, request)
			if err != nil || !got.OK || len(got.Diagnostics) != 0 || got.Message != "" || got.Function == nil {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			fn := got.Function
			if fn.File != request.EntryFile || fn.Name != export || fn.Panic != tc.panic || strings.Join(fn.TypedFailures, ",") != tc.failure || strings.Join(fn.Requirements, ",") != tc.requirement {
				t.Fatalf("wrong function facts: %+v", fn)
			}
			if fn.Span.Start < 0 || fn.Span.Length < 1 || fn.Span.Start+fn.Span.Length > utf16Extent(tc.source) {
				t.Fatalf("wrong authored UTF16 span: %+v", fn.Span)
			}
			var schema map[string]any
			if err := json.Unmarshal([]byte(fn.FailureSchemaJSON), &schema); err != nil || schema["role"] != "error" || schema["source"] != "compiler-derived" || schema["shape"] != "structural" {
				t.Fatalf("schema=%s err=%v", fn.FailureSchemaJSON, err)
			}
			if tc.failure == "" && schema["descriptor"].(map[string]any)["kind"] != "never" {
				t.Fatalf("empty error row lost its never codec: %s", fn.FailureSchemaJSON)
			}
			if tc.failure == "Failed" && !strings.Contains(fn.FailureSchemaJSON, "vibelang:functions.vibe@Failed@1") {
				t.Fatalf("failure lost its declaring source identity: %s", fn.FailureSchemaJSON)
			}
			if fn.ValueSchemasJSON != "" {
				t.Fatal("ordinary row inspection unexpectedly derived a durable value boundary")
			}
			request.DurableBoundary = true
			boundary, err := inspector.CheckedFunction(ctx, request)
			if err != nil || !boundary.OK || boundary.Function == nil {
				t.Fatalf("boundary=%+v err=%v", boundary, err)
			}
			var schemas map[string]any
			if err := json.Unmarshal([]byte(boundary.Function.ValueSchemasJSON), &schemas); err != nil || len(schemas) != 3 {
				t.Fatalf("value schemas=%+v err=%v", boundary.Function, err)
			}
			for key, role := range map[string]string{"inputSchema": "input", "successSchema": "success"} {
				schema := schemas[key].(map[string]any)
				if schema["role"] != role || schema["shape"] != "structural" || schema["descriptor"].(map[string]any)["kind"] != "number" {
					t.Fatalf("wrong %s: %+v", key, schema)
				}
			}
			completion := "value"
			if tc.name == "async" {
				completion = "promise"
			}
			if schemas["completion"] != completion {
				t.Fatalf("wrong completion mode: %+v", schemas)
			}
		})
	}
	for _, source := range []string{
		`export function work(): number { return "bad"; }`,
		`export function work() { return absent; }`,
		`export function work( {`,
		`class Failed extends Error {}; export function work(): number { throw new Failed(); }`,
		`function work(n: number) { return n; }`,
		`export const work = 42;`,
		`export class work { static run() { return 42; } }`,
		`import { helper } from "./missing"; export function work() { return helper(); }`,
		`class Failed extends Error { constructor(readonly data: unknown) { super(); } } export function work(): Result<number, Failed> { throw new Failed(1); }`,
		`class Failed extends Error { constructor(private data: string) { super(); } } export function work(): Result<number, Failed> { throw new Failed("x"); }`,
	} {
		t.Run("refuses "+source, func(t *testing.T) {
			got, err := inspector.CheckedFunction(ctx, CheckedFunctionRequest{Files: []SourceFile{{Path: "functions.vibe", Kind: FileKindVibeLang, Text: source}}, EntryFile: "functions.vibe", ExportName: "work"})
			if err != nil || got.OK || got.Function != nil || got.Message == "" {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	t.Run("complete source closure and logical nominal identity", func(t *testing.T) {
		files := []SourceFile{
			{Path: "lib/errors.vibe", Kind: FileKindVibeLang, Text: `export class Failed extends Error { constructor(readonly code: number) { super(); } }`},
			{Path: "lib/helper.vibe", Kind: FileKindVibeLang, Text: `import { Failed as Rejected } from "./errors"; export function helper(n: number): Result<number, Rejected> { if (n < 0) throw new Rejected(n); return n; }`},
			{Path: "main.vibe", Kind: FileKindVibeLang, Text: `import { helper } from "./lib/helper"; import type { Failed } from "./lib/errors"; export function work(n: number): Result<number, Failed> { return helper(n)!; }`},
		}
		got, err := inspector.CheckedFunction(ctx, CheckedFunctionRequest{Files: files, EntryFile: "main.vibe", ExportName: "work"})
		if err != nil || !got.OK || got.Function == nil || !strings.Contains(got.Function.FailureSchemaJSON, "vibelang:lib/errors.vibe@Failed@1") {
			t.Fatalf("got=%+v err=%v", got, err)
		}
		files = append(files, SourceFile{Path: "unused.vibe", Kind: FileKindVibeLang, Text: `export const value: number = "bad";`})
		got, err = inspector.CheckedFunction(ctx, CheckedFunctionRequest{Files: files, EntryFile: "main.vibe", ExportName: "work"})
		if err != nil || got.OK || got.Function != nil || len(got.Diagnostics) == 0 {
			t.Fatalf("unchecked unused source published proof: %+v err=%v", got, err)
		}
	})
	t.Run("bounded explicit inputs only", func(t *testing.T) {
		for _, request := range []CheckedFunctionRequest{
			{EntryFile: "main.vibe", ExportName: "work"},
			{Files: []SourceFile{{Path: "main.ts", Kind: FileKindTypeScript, Text: `export function work() { return 42; }`}}, EntryFile: "main.ts", ExportName: "work"},
			{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: strings.Repeat(" ", 2*1024*1024+1)}}, EntryFile: "main.vibe", ExportName: "work"},
			{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export function work() { return 42; }`}}, EntryFile: "other.vibe", ExportName: "work"},
		} {
			if got, err := inspector.CheckedFunction(ctx, request); err == nil {
				t.Fatalf("invalid request returned %+v", got)
			}
		}
	})
}

func TestPinnedForkCheckedFunctionDurableValueBoundary(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	inspector := backend.(CheckedFunctionInspector)
	for _, source := range []string{
		`export function work() { return 1; }`,
		`export function work(n: number, m: number) { return n + m; }`,
		`export function work(n?: number) { return n ?? 0; }`,
		`export function work(n = 0) { return n; }`,
		`export function work(...n: number[]) { return n.length; }`,
		`export function work<T>(n: T): T { return n; }`,
		`export function work(this: { n: number }, n: number) { return this.n + n; }`,
		`export function work(n: number): number; export function work(n: number) { return n; }`,
		`export function* work(n: number) { yield n; return n; }`,
		`export function work(n: number): void { const ignored = n; }`,
		`export function work(n: any): number { return 1; }`,
		`export function work(n: unknown): number { return 1; }`,
		`export function work(n: number): any { return n; }`,
		`export function work(n: number): unknown { return n; }`,
		`export function work(n: () => number): number { return n(); }`,
		`export function work(n: number) { return () => n; }`,
		`function inner(n: number): Result<number, never> { return n; } export function work(n: number): Result<Result<number, never>, never> { return inner(n); }`,
	} {
		t.Run("refuses "+source, func(t *testing.T) {
			request := CheckedFunctionRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}, EntryFile: "main.vibe", ExportName: "work", DurableBoundary: true}
			got, err := inspector.CheckedFunction(ctx, request)
			if err != nil || got.OK || got.Function != nil || got.Message == "" {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	for _, source := range []string{
		`export function work(n: { z: number; a: string }): { a: string; z: number } { return { a: n.a, z: n.z }; }`,
		`export const work = ({ n }: { n: [number, string] }): [string, number] => [n[1], n[0]];`,
		`class Failed extends Error {} function helper(n: number) { if (n < 0) throw new Failed(); return n; } export function work(n: number): Result<number, Failed> { return helper(n)!; }`,
		`async function helper(n: number) { return n; } export function work(n: number): Promise<number> { return helper(n); }`,
	} {
		t.Run("derives "+source, func(t *testing.T) {
			got, err := inspector.CheckedFunction(ctx, CheckedFunctionRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}, EntryFile: "main.vibe", ExportName: "work", DurableBoundary: true})
			if err != nil || !got.OK || got.Function == nil || got.Function.ValueSchemasJSON == "" {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
}

func TestCheckedFunctionValueSchemaProtocol(t *testing.T) {
	valid := `{"format":"canonical-json","schemaVersion":1,"role":"input","shape":"structural","source":"compiler-derived","descriptor":{"kind":"number"},"digest":"` + strings.Repeat("a", 64) + `"}`
	if !validCheckedFunctionSchema([]byte(valid), "input") || validCheckedFunctionSchema([]byte(valid), "success") {
		t.Fatal("schema role validation failed")
	}
	for _, bad := range []string{
		"", "null", "[]", "{}",
		strings.Replace(valid, `"number"`, `"\ud800"`, 1),
		strings.Replace(valid, `"descriptor":{"kind":"number"}`, `"descriptor":null`, 1),
		strings.Replace(valid, `"descriptor":{"kind":"number"}`, `"descriptor":[]`, 1),
		strings.Replace(valid, `"shape":"structural"`, `"shape":"json-value"`, 1),
		strings.Replace(valid, `"source":"compiler-derived"`, `"source":"host"`, 1),
		strings.Replace(valid, strings.Repeat("a", 64), strings.Repeat("A", 64), 1),
		strings.Replace(valid, `"role":"input"`, `"role":"input","role":"input"`, 1),
	} {
		if validCheckedFunctionSchema([]byte(bad), "input") {
			t.Fatalf("accepted %q", bad)
		}
	}
}
