package compiler

import (
	"fmt"
	"strings"
	"testing"
)

func TestPinnedForkDurableSchemaBoundaries(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, declaration, message string }{
		{"class", `class Payload { value = 1 }`, "class instances"},
		{"empty class", `class Payload {}`, "class instances"},
		{"generic class", `class Box<T> { constructor(readonly value: T) {} }; type Payload = Box<number>`, "class instances"},
		{"getter", `type Payload = { get value(): number }`, "executable/accessor"},
		{"setter", `type Payload = { set value(value: number) }`, "executable/accessor"},
		{"constructor", `type Payload = new () => { value: number }`, "callable objects"},
		{"callable", `type Payload = () => number`, "callable objects"},
		{"method", `type Payload = { read(): number }`, "executable/accessor"},
		{"rest tuple", `type Payload = [number, ...number[]]`, "optional/rest tuple"},
		{"optional tuple", `type Payload = [number, string?]`, "optional/rest tuple"},
		{"variadic tuple", `type Tuple<T extends number[]> = [string, ...T]; type Payload = Tuple<number[]>`, "optional/rest tuple"},
		{"generic interface", `interface Box<T> { value: T }; type Payload = Box<number>`, "generic declarations"},
		{"library record", `type Payload = PropertyDescriptor`, "host objects"},
		{"symbol field", `declare const key: unique symbol; type Payload = { [key]: number }`, "symbol-named"},
		{"unpaired field", `type Payload = { "\ud800": number }`, "unpaired surrogate"},
		{"empty field", `type Payload = { "": number }`, "non-empty names"},
		{"unpaired literal", `type Payload = "\udfff"`, "unpaired surrogate"},
		{"recursive", `interface Payload { next?: Payload }`, "recursive persistence"},
		{"intersection", `type Payload = { a: number } & { b: string }`, "unsupported persistence"},
		{"index signature", `type Payload = { [key: string]: number }`, "index signatures"},
		{"optional undefined only", `type Payload = { value?: undefined }`, "no encodable value"},
		{"required undefined union", `type Payload = { value: number | undefined }`, "undefined"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import { durable } from "vibelang:flows"; ` + tc.declaration + `;
export const Build = durable((input: Payload) => { return input; });`
			result := compileDurableWith(t, backend, ctx, source)
			issue := requireDurableDiagnostic(t, result, "VIBE4110", strings.Index(source, "input: Payload"))
			if !strings.Contains(issue.Message, tc.message) || len(result.Artifacts) != 0 {
				t.Fatalf("refusal=%+v artifacts=%d, wanted %s", issue, len(result.Artifacts), tc.message)
			}
		})
	}
	for _, declaration := range []string{
		`type Payload = { readonly value: number; note?: string }`,
		`type Payload = readonly [number, string]`,
		`type Payload = readonly number[]`,
		`type Payload = number | string | null`,
		`type Payload = { "__proto__": number; "constructor": number; "__@data": string }`,
		`type Payload = { "🐱": "\ud83d\udc31" }`,
		`type Payload = { value?: number | string }`,
		`interface Shared { value: number }; type Payload = { a: Shared; b: Shared }`,
	} {
		t.Run("accepts "+declaration, func(t *testing.T) {
			source := `import { durable } from "vibelang:flows"; ` + declaration + `;
export const Build = durable((input: Payload) => { return input; });`
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				t.Fatalf("valid durable data refused: %+v", result.Diagnostics)
			}
			if len(validateWithReferenceArtifactRules(t, result)) != 64 {
				t.Fatal("emitted durable artifact failed its actual runtime validation")
			}
		})
	}
}

func TestPinnedForkDurableSchemaBudgets(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	fields, variants := []string{}, []string{}
	for i := 0; i < 1025; i++ {
		fields = append(fields, fmt.Sprintf("f%d: number", i))
	}
	for i := 0; i < 129; i++ {
		variants = append(variants, fmt.Sprintf("%q", fmt.Sprintf("v%d", i)))
	}
	deep := `interface T0 { value: number }; `
	for i := 1; i <= 66; i++ {
		deep += fmt.Sprintf("interface T%d { next: T%d }; ", i, i-1)
	}
	wide := `interface T0 { value: number }; `
	for i := 1; i <= 13; i++ {
		wide += fmt.Sprintf("interface T%d { a: T%d; b: T%d }; ", i, i-1, i-1)
	}
	literals := []string{}
	for i := 0; i < 20; i++ {
		literals = append(literals, fmt.Sprintf("f%d: Word", i))
	}
	largeLiteral := `type Word = "` + strings.Repeat("x", 512*1024) + `"; type Payload = { ` + strings.Join(literals, ";") + " }"
	for _, tc := range []struct{ name, declaration, message string }{
		{"fields", "type Payload = { " + strings.Join(fields, ";") + " }", "field limit"},
		{"variants", "type Payload = " + strings.Join(variants, " | "), "variant limit"},
		{"depth", deep + "type Payload = T66", "depth limit"},
		{"expanded nodes", wide + "type Payload = T13", "node limit"},
		{"expanded text", largeLiteral, "byte budget"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import { durable } from "vibelang:flows"; ` + tc.declaration + `;
export const Build = durable((input: Payload) => { return input; });`
			result := compileDurableWith(t, backend, ctx, source)
			issue := requireDurableDiagnostic(t, result, "VIBE4110", strings.Index(source, "input: Payload"))
			if !strings.Contains(issue.Message, tc.message) || len(result.Artifacts) != 0 {
				t.Fatalf("refusal=%+v artifacts=%d, wanted %s", issue, len(result.Artifacts), tc.message)
			}
		})
	}
}

func TestPinnedForkDurableActionUsesTheSameSchemaRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, declaration := range []string{
		`class Payload { value = 1 }`,
		`type Payload = { get value(): number }`,
		`type Payload = [number, ...number[]]`,
	} {
		t.Run(declaration, func(t *testing.T) {
			source := `import { durable, Action } from "vibelang:flows"; ` + declaration + `;
class Read extends Action<(input: number) => Result<Payload, never>> {}
export const Build = durable((input: number) => { const answer = Read.run(input)!; return answer; });`
			result := compileDurableWith(t, backend, ctx, source)
			if !result.EmitSkipped || len(result.Artifacts) != 0 || len(result.Diagnostics) == 0 {
				t.Fatalf("unsafe Action answer accepted: %+v", result.Diagnostics)
			}
		})
	}
}

func TestPinnedForkDurableSchemaBudgetSpansACompleteAction(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	types := `interface T0 { value: number }; `
	for i := 1; i <= 11; i++ {
		types += fmt.Sprintf("interface T%d { a: T%d; b: T%d }; ", i, i-1, i-1)
	}
	for _, tc := range []struct{ name, declaration, input, output, failure, message string }{
		{"combined input and output", "", "T11", "T11", "never", "node limit"},
		{"combined Error fields", `class Failed extends Error { declare a: T10; declare b: T10; declare c: T10; declare d: T10 }`, "number", "number", "Failed", "node limit"},
		{"unpaired Error field", `class Failed extends Error { declare "\ud800": number }`, "number", "number", "Failed", "non-empty scalar name"},
		{"empty Error field", `class Failed extends Error { declare "": number }`, "number", "number", "Failed", "non-empty scalar name"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import { durable, Action } from "vibelang:flows"; ` + types + tc.declaration + fmt.Sprintf(`;
class Read extends Action<(input: %s) => Result<%s, %s>> {}
export const Build = durable((input: %s) => { const answer = Read.run(input)!; return answer; });`, tc.input, tc.output, tc.failure, tc.input)
			result := compileDurableWith(t, backend, ctx, source)
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("invalid Action contract emitted an artifact")
			}
			found := false
			for _, issue := range result.Diagnostics {
				found = found || strings.Contains(issue.Message, tc.message)
			}
			if !found {
				t.Fatalf("expected %s in %+v", tc.message, result.Diagnostics)
			}
		})
	}
}
