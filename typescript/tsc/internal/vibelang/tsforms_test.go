package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Where the VibeLang form would change what the program does, the rule says
// so without a fix, or says nothing when VibeLang has no form at all.
// Chapter 007 / untagged errors cannot gain a tag through a teaching fix: docs/design/src/007-tooling.md#127ef03dfd6edfb7
func TestTypeScriptFormRefusals(t *testing.T) {
	for _, test := range []struct {
		name   string
		source string
		code   int32
		why    string // the note of a warning without a fix, or "" for no warning
	}{
		{"error tag differs from the name", `export class Renamed extends Data.TaggedError("app/Renamed")<{ id: string }> {}`, 4830, `the tag would become "Renamed" instead of "app/Renamed"`},
		{"untagged Data.Error", `export class Untagged extends Data.Error<{ id: string }> {}`, 4830, `adds a _tag, "Untagged"`},
		{"Schema error tag differs from the name", `export class Failed extends Schema.TaggedError<Failed>()("app/Failed", { id: Schema.String }) {}`, 4837, "a schema error's tag is its name"},
		{"fields from a named type", "interface Fields { id: string }\nexport class Named extends Data.TaggedError(\"Named\")<Fields> {}", 4830, "the fields come from Fields"},
		{"error class with members", `export class Custom extends Data.TaggedError("Custom")<{ id: string }> { get message() { return this.id } }`, 4830, ""},
		{"struct with optionalKey", `export const Exact = Schema.Struct({ id: Schema.optionalKey(Schema.String) })`, 4832, ""},
		{"struct with an annotation", `export const Named = Schema.Struct({ id: Schema.String }).annotate({ identifier: "Named" })`, 4832, ""},
		{"struct whose name is another type", "type Point = { x: number }\nexport const Point = Schema.Struct({ x: Schema.Number })", 4832, ""},
		{"source parentheses around the reference", "export type Maybe = (Effect.Effect<number>) | undefined", 4833, "source-written parentheses around this Effect type"},
		{"source parentheses around a slot", "export type Make = Effect.Effect<(() => number)>", 4833, "source-written parentheses in Effect type argument 1"},
		{"prelude spelling", `export type Load = (id: string) => Effect<string, never, never>`, 4833, ""},
		{"inferred requirements", `export function load(): Effect.Effect<number, never, infer R> { return 1 }`, 4833, ""},
		{"interface extending an Effect", "export interface Api<A> extends Effect.Effect<A, never, never> {\n  readonly kind: \"Api\"\n}", 4833, ""},
		{"inferred errors", `export function load(): Effect.Effect<number, infer E, never> { return 1 }`, 4833, ""},
		{"succeed passed to a combinator", `export effect function patient() { return try retry(Effect.succeed(1), Schedule.recurs(1)) }`, 4834, ""},
		{"succeed of an Effect", "const inner: Effect.Effect<number> = Effect.sync(() => 1)\nexport effect function outer() { return try Effect.succeed(inner) }", 4834, directTrySafetyNote},
		{"succeed no try runs", `export const free = { run: () => Effect.succeed(1) }`, 4834, ""},
		{"catchTag with a block handler", "error Gone\neffect function find(): string!Gone { throw new Gone() }\nexport effect function f() { return try Effect.catchTag(find(), \"Gone\", () => { const x = Effect.succeed(1); return x }) }", 4835, directTrySafetyNote},
		{"catch no try runs", "error Gone\neffect function find(): string!Gone { throw new Gone() }\nexport function f() { return Effect.catch(find(), () => Effect.succeed(1)) }", 4835, ""},
		{"provide as a value", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\neffect function name() { return try (try Region).name() }\nexport effect function region() {\n  const name2 = try Effect.provide(name(), RegionLive)\n  return name2\n}", 4836, "a provide block stands only as a statement or a return"},
		{"provide no try runs", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\neffect function name() { return try (try Region).name() }\nexport function region() {\n  return Effect.provide(name(), RegionLive)\n}", 4836, ""},
		{"provideService keeps native scope", provideServiceScopeSource, 4836, "Layer.CurrentMemoMap"},
		// The VibeLang form already: the global withSpan.
		{"global withSpan", "effect function find() { return 1 }\nexport function traced() { return withSpan(find(), \"find\") }", 4836, ""},
		{"withSpan shadowed", "function withSpan(name: string) { return name }\nexport function f() { return Effect.withSpan(Effect.succeed(1), \"x\") }", 4836, ""},
		// The call evaluates its program before the layers build; the block, after.
		{"provide of a plain call", "const RegionLive = Layer.empty\nlet calls = 0\nfunction make() { calls = calls + 1; return Effect.succeed(calls) }\nexport effect function region() {\n  return try Effect.provide(make(), RegionLive)\n}", 4836, "bind it to a const first"},
		{"provide of an effect call with a plain argument", "let calls = 0\nfunction tick() { calls = calls + 1; return calls }\neffect function load(n: number) { return n }\nexport effect function region() {\n  return try Effect.provide(load(tick()), Layer.empty)\n}", 4836, "bind it to a const first"},
		{"provide of a program read through a getter", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\nconst holder = { get app(): string!!Region { return effect { return try (try Region).name() } } }\nexport effect function region() {\n  return try Effect.provide(holder.app, RegionLive)\n}", 4836, "bind it to a const first"},
		{"provide of a program the file reassigns", "let job: number!! = effect { return 1 }\nexport function swap() { job = effect { return 2 } }\nexport effect function run() {\n  return try Effect.provide(job, Layer.empty)\n}", 4836, "bind it to a const first"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			var found *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == test.code {
					found = d
				}
			}
			switch {
			case test.why == "" && found != nil:
				t.Fatalf("unexpected EK%d: %s", test.code, found.String())
			case test.why != "" && found == nil:
				t.Fatalf("missing EK%d", test.code)

			}
		})
	}
}
