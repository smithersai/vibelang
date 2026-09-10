package compiler

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

const bodyContractRuntime = `export declare abstract class ResultValue<A, E extends Error> { private brand: [A, E]; }
export type Result<A, E extends Error> = ResultValue<A, E>;
export type Resumable<A> = Generator<unknown, A, unknown>;
export type AsyncResumable<A> = AsyncGenerator<unknown, A, unknown>;`

func TestPinnedForkNativeBodyContract(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	compiler := backend.(BodyContractDeriver)
	request := func(source string) BodyContractRequest {
		return BodyContractRequest{Project: GeneratedProjectRequest{CurrentDirectory: "/body", Files: []GeneratedProjectFile{
			{Path: "/body/entry.ts", Text: source}, {Path: "/sdk/runtime.d.ts", Text: bodyContractRuntime},
		}}, EntryFile: "/body/entry.ts", Entry: "Flow", LogicalFileName: "flows/test.vibe", RuntimeSpecifier: "/sdk/runtime.d.ts"}
	}
	for _, tc := range []struct {
		name, source, input, success, failure string
		resumable, async                      bool
	}{
		{"pure", `export const Flow = (n: number) => n + 1`, "number", "number", "never", false, false},
		{"default input", `export const Flow = (n: number = 1) => n + 1`, "number", "number", "never", false, false},
		{"async", `export const Flow = async (n: number) => n + 1`, "number", "number", "never", false, true},
		{"Result identity", `import type {Result as Answer} from "/sdk/runtime.d.ts"; export declare const Flow: (n: number) => Answer<string, Error>`, "number", "string", "error", false, false},
		{"renamed local Result", `type Result = {value: number, failure: string}; export const Flow = (n: number): Result => ({value: n, failure: "x"})`, "number", "object", "never", false, false},
		{"resumable", `import type {Resumable, Result} from "/sdk/runtime.d.ts"; export declare const Flow: (n: number) => Resumable<Result<string, Error>>`, "number", "string", "error", true, false},
		{"async resumable", `import type {AsyncResumable, Result} from "/sdk/runtime.d.ts"; export declare const Flow: (n: number) => AsyncResumable<Result<string, Error>>`, "number", "string", "error", true, true},
		{"array and optional", `export const Flow = (input: {a?: string, b: readonly [number, string]}) => [input.b[0]]`, "object", "array", "never", false, false},
		{"never", `export const Flow = (_input: number): never => {throw 1}`, "number", "never", "never", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := request(tc.source)
			input.Resumable, input.Async = tc.resumable, tc.async
			got, err := compiler.BodyContract(ctx, input)
			if err != nil || !got.OK {
				t.Fatalf("contract: %+v err=%v", got, err)
			}
			var schemas map[string]struct {
				Descriptor struct{ Kind, Identity string }
				Role       string
			}
			if err := json.Unmarshal([]byte(got.SchemasJSON), &schemas); err != nil {
				t.Fatal(err)
			}
			for key, kind := range map[string]string{"inputSchema": tc.input, "successSchema": tc.success, "failureSchema": tc.failure} {
				if schemas[key].Descriptor.Kind != kind {
					t.Fatalf("%s: %s", key, got.SchemasJSON)
				}
			}
			if tc.failure == "error" && schemas["failureSchema"].Descriptor.Identity != "javascript:Error@1" {
				t.Fatal(got.SchemasJSON)
			}
		})
	}
	for _, tc := range []struct{ name, source, reason, message string }{
		{"unchecked root", `export const Flow = (n: number): string => n`, "check", "native checking"},
		{"noncallable", `export const Flow = 1`, "entry", "call signature"},
		{"nested entry", `export function f() {const Flow = (n:number) => n; return Flow}`, "entry", "module-level"},
		{"overloaded", `export declare const Flow: { (n: number): number; (n: string): string }`, "entry", "call signature"},
		{"any", `export const Flow = (n: any) => n`, "boundary", "any"},
		{"unknown", `export const Flow = (n: unknown) => n`, "boundary", "unknown"},
		{"function", `export const Flow = (n: number) => () => n`, "boundary", "callable"},
		{"host", `export const Flow = (n: Date) => n`, "boundary", "host"},
		{"class", `class Result<A,E> { constructor(readonly a:A, readonly e:E) {} }; export const Flow = (n: number) => new Result(n, "bad")`, "boundary", "class"},
		{"recursive", `type Tree = {next?: Tree}; export const Flow = (n: Tree) => n`, "boundary", "recursive"},
		{"surrogate", `export const Flow = (n: "\ud800") => n`, "boundary", "surrogate"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := compiler.BodyContract(ctx, request(tc.source))
			if err != nil || got.OK || got.Reason != tc.reason || !strings.Contains(got.Message, tc.message) || got.SchemasJSON != "" {
				t.Fatalf("refusal: %+v err=%v", got, err)
			}
		})
	}
	t.Run("calling convention is checked against real native generator and Promise symbols", func(t *testing.T) {
		for _, source := range []string{`import type {} from "/sdk/runtime.d.ts"; export const Flow = (n: number) => n`,
			`import type {} from "/sdk/runtime.d.ts"; interface Generator<A,B,C> {a:A;b:B;c:C}; export declare const Flow: (n:number)=>Generator<unknown, number, unknown>`} {
			input := request(source)
			input.Resumable = true
			got, err := compiler.BodyContract(ctx, input)
			if err != nil || got.OK || got.Reason != "entry" || !strings.Contains(got.Message, "calling convention") {
				t.Fatalf("convention: %+v err=%v", got, err)
			}
		}
	})
	for _, tc := range []struct {
		name   string
		change func(*BodyContractRequest)
	}{
		{"entry outside roots", func(r *BodyContractRequest) { r.EntryFile = "/elsewhere/entry.ts" }},
		{"relative entry path", func(r *BodyContractRequest) { r.EntryFile = "entry.ts" }},
		{"foreign entry configuration", func(r *BodyContractRequest) { r.Project.Files[0].Configuration = "typescript" }},
		{"non-normalized path", func(r *BodyContractRequest) { r.EntryFile = "/body/../body/entry.ts" }},
		{"empty logical identity", func(r *BodyContractRequest) { r.LogicalFileName = " " }},
		{"NUL identity", func(r *BodyContractRequest) { r.LogicalFileName = "flow\x00.vibe" }},
		{"entry expression", func(r *BodyContractRequest) { r.Entry = "Flow()" }},
		{"entry identifier prefix", func(r *BodyContractRequest) { r.Entry = "Flow.other" }},
		{"missing runtime policy", func(r *BodyContractRequest) { r.RuntimeSpecifier = "" }},
		{"oversized input", func(r *BodyContractRequest) { r.Project.Files[0].Text = strings.Repeat(" ", 2*1024*1024+1) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := request(`export const Flow=(n:number)=>n`)
			tc.change(&r)
			if _, err := compiler.BodyContract(ctx, r); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
	t.Run("nominal error identities use the authored logical source and canonical payload order", func(t *testing.T) {
		got, err := compiler.BodyContract(ctx, request(`import type {Result} from "/sdk/runtime.d.ts";
class Missing extends Error { constructor(readonly z: string, readonly a: number) {super(z)} }
export declare const Flow: (n: number) => Result<number, Missing>`))
		if err != nil || !got.OK {
			t.Fatalf("nominal contract: %+v err=%v", got, err)
		}
		if !strings.Contains(got.SchemasJSON, `"identity":"vibelang:flows/test.vibe@Missing@1"`) ||
			!strings.Contains(got.SchemasJSON, `"name":"a","optional":false`) {
			t.Fatal(got.SchemasJSON)
		}
	})
	t.Run("the unused supplied graph still receives mandatory checking", func(t *testing.T) {
		r := request(`export const Flow=(n:number)=>n`)
		r.Project.Files = append(r.Project.Files, GeneratedProjectFile{Path: "/body/unused.ts", Text: `export const bad: number = "bad"`})
		got, err := compiler.BodyContract(ctx, r)
		if err != nil || got.OK || got.Reason != "check" || len(got.Diagnostics) != 1 || got.Diagnostics[0].File != "/body/unused.ts" || got.Diagnostics[0].Code != "TS2322" {
			t.Fatalf("unchecked source: %+v err=%v", got, err)
		}
	})
	for _, identical := range []bool{false, true} {
		name := "different payloads"
		field := "reason"
		if identical {
			name = "identical payloads"
			field = "code"
		}
		t.Run("nominal failure collisions refuse "+name, func(t *testing.T) {
			r := request(`import type {Result} from "/sdk/runtime.d.ts";
namespace Left {export class Failed extends Error {constructor(readonly code: string){super(code)}}}
namespace Right {export class Failed extends Error {constructor(readonly ` + field + `: string){super(` + field + `)}}}
export declare const Flow: (n:number)=>Result<number, Left.Failed | Right.Failed>;`)
			got, err := compiler.BodyContract(ctx, r)
			if err != nil || got.OK || got.Reason != "boundary" || !strings.Contains(got.Message, "share one durable failure identity") {
				t.Fatalf("collision: %+v err=%v", got, err)
			}
		})
	}
	t.Run("descriptor budgets belong to each Flow codec", func(t *testing.T) {
		makeSource := func(fields int) string {
			var source strings.Builder
			source.WriteString(`type Leaf = [number,number,number,number,number,number,number,number,number,number]; type Many = {`)
			for i := 0; i < fields; i++ {
				fmt.Fprintf(&source, "p%d: Leaf;", i)
			}
			source.WriteString(`}; export const Flow = (n: Many) => n`)
			return source.String()
		}
		// Each role expands to 6,601 nodes, below its 10,000-node limit;
		// their sum is not a third, stricter aggregate descriptor budget.
		got, err := compiler.BodyContract(ctx, request(makeSource(600)))
		if err != nil || !got.OK {
			t.Fatalf("combined role budget: %+v err=%v", got, err)
		}
		tooLarge, err := compiler.BodyContract(ctx, request(makeSource(950)))
		if err != nil || tooLarge.OK || tooLarge.Reason != "boundary" || !strings.Contains(tooLarge.Message, "node limit") {
			t.Fatalf("missing individual limit: %+v err=%v", tooLarge, err)
		}
	})
}
