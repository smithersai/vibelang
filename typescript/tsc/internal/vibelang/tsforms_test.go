package vibelang

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// D284-D290 promise that each TypeScript-style form's quick fix writes the
// VibeLang form exactly. Ask the language service for the fix of the one
// diagnostic, apply every edit, compare the whole document, and check that
// the result reports no error and no longer reports the code.
// Chapter 007 / teaching repairs preserve classes, service keys, schema fields and run context: docs/design/src/007-tooling.md#a86eb109ac06b822
// Chapter 007 / teaching repairs preserve classes, service keys, schema fields and run context: docs/design/src/007-tooling.md#a0f677b77e272550
// Chapter 007 / teaching repairs preserve classes, service keys, schema fields and run context: docs/design/src/007-tooling.md#27d173a375f3d0d1
// Chapter 007 / teaching repairs preserve classes, service keys, schema fields and run context: docs/design/src/007-tooling.md#21ed67f7082829ac
// Chapter 007 / teaching repairs preserve classes, service keys, schema fields and run context: docs/design/src/007-tooling.md#4016d8e894bcd5ac
// Chapter 007 / teaching repairs preserve classes, service keys, schema fields and run context: docs/design/src/007-tooling.md#f057bb3dc87e016d
// Chapter 007 / teaching repairs preserve classes, service keys, schema fields and run context: docs/design/src/007-tooling.md#d371cd37f2cedaf7
// Chapter 007 / teaching repairs preserve classes, service keys, schema fields and run context: docs/design/src/007-tooling.md#463e9d4e25b88138
// Chapter 007 / teaching repairs preserve classes, service keys, schema fields and run context: docs/design/src/007-tooling.md#568a551a16a7c023
// Chapter 007 / own diagnostics explain mechanical repairs and their actual editor actions: docs/design/src/007-tooling.md#dcce1a6fdc2157d3
func TestTypeScriptFormQuickFixes(t *testing.T) {
	for _, test := range []struct {
		name   string
		code   int32
		source string
		want   string
	}{
		// EK4830 (D284)
		{"tagged error", 4830, `export class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string; count: number }> {}`, `export error NotFound { id: string; count: number }`},
		{"error without fields", 4830, `class Timeout extends Data.TaggedError("Timeout") {}` + "\nexport const t = new Timeout()", "error Timeout\nexport const t = new Timeout()"},
		{"prelude TaggedError", 4830, `export class Gone extends TaggedError("Gone")<{ id: string }> {}`, `export error Gone { id: string }`},
		{"last use of the import", 4830, "import * as Data from \"effect/Data\"\n/** Gone. */\nexport class Gone extends Data.TaggedError(\"Gone\")<{ id: string }> {}", "/** Gone. */\nexport error Gone { id: string }"},
		// EK4831 (D285)
		{"service mutable field", 4831, `export class Counter extends Context.Service<Counter, { mutable /* keep */ n: number; readonly label: string; mutable: string }>()("app/Counter") {}`, `export service Counter { static readonly key = "app/Counter"; /* keep */ n: number; readonly label: string; mutable: string }`},
		{"service", 4831, "export class Users extends Context.Service<Users, {\n  find(id: string): Effect.Effect<string>\n  readonly region: string,\n  size: (name: string) => number!!\n}>()(\"app/Users\") {}", "export service Users {\n  static readonly key = \"app/Users\"\n  find(id: string): string!!\n  readonly region: string\n  size: (name: string) => number!!\n}"},
		{"service with its type arguments on lines", 4831, "export class RenderCommit extends Context.Service<\n  RenderCommit,\n  {\n    readonly isCommitPending: () => boolean\n    readonly onNextCommit: (callback: () => void) => () => void\n  }\n>()(\"app/RenderCommit\") {}", "export service RenderCommit {\n  static readonly key = \"app/RenderCommit\"\n  readonly isCommitPending: () => boolean\n  readonly onNextCommit: (callback: () => void) => () => void\n}"},
		{"one-line service", 4831, `export class Clock2 extends Context.Service<Clock2, { now(): Effect.Effect<number, never, never>, zone: string }>()("app/Clock2") {}`, `export service Clock2 { static readonly key = "app/Clock2"; now(): number!!; zone: string }`},
		// EK4832 (D286)
		{"struct and its type", 4832, "export const User = Schema.Struct({ id: Schema.String, nickname: Schema.optional(Schema.String), role: Schema.Literals([\"admin\", \"member\"]) })\nexport type User = typeof User.Type\nexport const u: User = { id: \"1\", role: \"admin\" }", "export schema User { readonly id: string; readonly nickname?: string; readonly role: \"admin\" | \"member\" }\nexport const u: User = { id: \"1\", role: \"admin\" }"},
		{"every field form", 4832, "export const Order = Schema.Struct({\n  items: Schema.Array(Schema.Union([Schema.String, Schema.Number])),\n  pair: Schema.Tuple([Schema.String, Schema.Boolean]),\n  tags: Schema.Record(Schema.String, Schema.Number),\n  status: Schema.mutableKey(Schema.Literal(\"open\")),\n  note: Schema.optional(Schema.Union([Schema.String, Schema.Null])),\n  meta: Schema.Struct({ ok: Schema.Boolean }),\n  count: Schema.Finite\n})", "export schema Order {\n  readonly items: ReadonlyArray<string | number>\n  readonly pair: readonly [string, boolean]\n  readonly tags: Readonly<Record<string, number>>\n  status: \"open\"\n  readonly note?: string | null\n  readonly meta: { readonly ok: boolean }\n  readonly count: Schema.Finite\n}"},
		{"local struct", 4832, "export function decode(value: unknown) {\n  const Local = Schema.Struct({ value: Schema.String })\n  return Schema.decodeUnknownEffect(Local)(value)\n}", "export function decode(value: unknown) {\n  schema Local { readonly value: string }\n  return Schema.decodeUnknownEffect(Local)(value)\n}"},
		// EK4833 (D287)
		{"full contract", 4833, `export effect function load(): Effect.Effect<number, never, never> { return 1 }`, `export effect function load(): number!! { return 1 }`},
		{"never dependencies in a body's return", 4833, "error Gone\nexport effect function load(): Effect.Effect<number, Gone, never> { return 1 }", "error Gone\nexport effect function load(): number!Gone { return 1 }"},
		{"parameter", 4833, `export effect function run(program: Effect.Effect<number>): number!! { return try program }`, `export effect function run(program: number!!): number!! { return try program }`},
		{"type argument in a heritage clause", 4833, `export interface Programs<A> extends ReadonlyArray<Effect.Effect<A>> {}`, `export interface Programs<A> extends ReadonlyArray<A!!> {}`},
		{"partial contract on a body", 4833, `export effect function load(): Effect.Effect<number> { return 1 }`, `export effect function load(): number!! { return 1 }`},
		{"partial contract with errors on a body", 4833, "error Gone\nexport effect function load(): Effect.Effect<number, Gone> { return 1 }", "error Gone\nexport effect function load(): number!Gone { return 1 }"},
		// EK4834 (D288)
		{"succeed in a return", 4834, "export effect function find(id: number) {\n  if (id === 0) throw new Error(\"no\")\n  return try Effect.succeed(\"Ada\")\n}", "export effect function find(id: number) {\n  if (id === 0) throw new Error(\"no\")\n  return \"Ada\"\n}"},
		{"fail in a return", 4834, "error Gone\nexport effect function find(id: number) {\n  if (id === 0) return try Effect.fail(new Gone())\n  return 1\n}", "error Gone\nexport effect function find(id: number) {\n  if (id === 0) throw new Gone()\n  return 1\n}"},
		{"fail as a statement", 4834, "error Gone\nexport effect function find(id: number) {\n  try Effect.fail(new Gone())\n  return 1\n}", "error Gone\nexport effect function find(id: number) {\n  throw new Gone()\n  return 1\n}"},
		{"succeed in an effect arrow", 4834, "export const read: () => Effect.Effect<{ ok: boolean }> = effect () => try Effect.succeed({ ok: true })", "export const read: () => Effect.Effect<{ ok: boolean }> = effect () => ({ ok: true })"},
		{"fail of a Cause", 4834, "export effect function rethrow(cause: Cause.Cause<string>) {\n  return try Effect.fail(cause)\n}", "export effect function rethrow(cause: Cause.Cause<string>) {\n  throw cause\n}"},
		{"fail in an effect arrow", 4834, "error Gone\nexport const gone: () => Effect.Effect<never, Gone> = effect () => try Effect.fail(new Gone())", "error Gone\nexport const gone: () => Effect.Effect<never, Gone> = effect () => throw new Gone()"},
		// EK4835 (D289)
		{"method catchTag", 4835, "error Gone { id: number }\neffect function find(id: number): string!Gone { throw new Gone({ id }) }\nexport effect function describe(id: number) { return try find(id).pipe(Effect.catchTag(\"Gone\", (e) => Effect.succeed(\"gone \" + e.id))) }", "error Gone { id: number }\neffect function find(id: number): string!Gone { throw new Gone({ id }) }\nexport effect function describe(id: number) { return find(id) catch (e) => match (e) { when { _tag: \"Gone\" }: (\"gone \" + e.id); } }"},
		{"method catch of an Effect value", 4835, "error Gone\nconst job: string!Gone = effect { throw new Gone() }\nexport effect function recover() { return try job.pipe(Effect.catch(() => Effect.succeed(\"none\"))) }", "error Gone\nconst job: string!Gone = effect { throw new Gone() }\nexport effect function recover() { return job catch () => \"none\" }"},
		{"catchTag keeps succeed of a cold program", 4835, `error Gone
effect function fail() { throw new Gone() }
const job: number!! = effect { return 1 }
export effect function recover() { return try Effect.catchTag(fail(), "Gone", () => Effect.succeed(job)) }`, `error Gone
effect function fail() { throw new Gone() }
const job: number!! = effect { return 1 }
export effect function recover() { return fail() catch effect (e) => match (e) { when { _tag: "Gone" }: try Effect.succeed(job); } }`},
		{"catchTag simplifies succeed object", 4835, `error Gone
effect function fail() { throw new Gone() }
export effect function recover() { return try Effect.catchTag(fail(), "Gone", () => Effect.succeed({ ok: true })) }`, `error Gone
effect function fail() { throw new Gone() }
export effect function recover() { return fail() catch (e) => match (e) { when { _tag: "Gone" }: ({ ok: true }); } }`},
		{"catch fallback simplifies conditional succeed", 4835, `error Gone
effect function fail() { throw new Gone() }
export effect function recover(flag: boolean) { return try Effect.catch(fail(), () => Effect.succeed(flag ? 1 : 2)) }`, `error Gone
effect function fail() { throw new Gone() }
export effect function recover(flag: boolean) { return fail() catch () => (flag ? 1 : 2) }`},
		{"catchTag of a declared error", 4835, "error Gone { id: number }\neffect function find(id: number): string!Gone { throw new Gone({ id }) }\nexport effect function describe(id: number) { return try Effect.catchTag(find(id), \"Gone\", (e) => Effect.succeed(`gone ${e.id}`)) }", "error Gone { id: number }\neffect function find(id: number): string!Gone { throw new Gone({ id }) }\nexport effect function describe(id: number) { return find(id) catch (e) => match (e) { when { _tag: \"Gone\" }: `gone ${e.id}`; } }"},
		{"catchTags", 4835, "error Gone\nerror Slow\neffect function find(id: number): string!(Gone | Slow) { if (id < 0) throw new Slow(); throw new Gone() }\nexport effect function both(id: number) { return try Effect.catchTags(find(id), { Gone: () => Effect.succeed(\"gone\"), Slow: () => Effect.succeed(\"slow\") }) }", "error Gone\nerror Slow\neffect function find(id: number): string!(Gone | Slow) { if (id < 0) throw new Slow(); throw new Gone() }\nexport effect function both(id: number) { return find(id) catch (e) => match (e) { when { _tag: \"Gone\" }: \"gone\"; when { _tag: \"Slow\" }: \"slow\"; } }"},
		{"catchTag of a structural tag", 4835, "class Tagged { readonly _tag = \"Tagged\" as const }\neffect function fail(): string!Tagged { throw new Tagged() }\nexport effect function recover() { return try Effect.catchTag(fail(), \"Tagged\", () => Effect.succeed(\"ok\")) }", "class Tagged { readonly _tag = \"Tagged\" as const }\neffect function fail(): string!Tagged { throw new Tagged() }\nexport effect function recover() { return fail() catch (e) => match (e) { when { _tag: \"Tagged\" }: \"ok\"; } }"},
		{"catch with a handler", 4835, "error Gone\neffect function find(): string!Gone { throw new Gone() }\nexport effect function any() { return try Effect.catch(find(), (e) => Effect.succeed(e._tag)) }", "error Gone\neffect function find(): string!Gone { throw new Gone() }\nexport effect function any() { return find() catch (e) => e._tag }"},
		{"catch with a fallback", 4835, "error Gone\neffect function find(): string!Gone { throw new Gone() }\nexport effect function any() { return try Effect.catch(find(), () => Effect.succeed(\"none\")) }", "error Gone\neffect function find(): string!Gone { throw new Gone() }\nexport effect function any() { return find() catch () => \"none\" }"},
		{"catch with an Effect handler", 4835, "error Gone\neffect function find(): string!Gone { throw new Gone() }\neffect function recover(e: Gone) { return e._tag }\nexport effect function any() { return try Effect.catch(find(), (e) => recover(e)) }", "error Gone\neffect function find(): string!Gone { throw new Gone() }\neffect function recover(e: Gone) { return e._tag }\nexport effect function any() { return find() catch effect (e) => try recover(e) }"},
		{"catch that fails again", 4835, "error Gone\nerror Lost\neffect function find(): string!Gone { throw new Gone() }\nexport effect function any() { return try Effect.catch(find(), () => Effect.fail(new Lost())) }", "error Gone\nerror Lost\neffect function find(): string!Gone { throw new Gone() }\nexport effect function any() { return find() catch effect () => throw new Lost() }"},
		{"catchTag of part of E", 4835, "error Gone\nerror Slow\neffect function find(n: number): string!(Gone | Slow) { if (n < 0) throw new Slow(); throw new Gone() }\nexport effect function partial(n: number) { return try Effect.catchTag(find(n), \"Gone\", () => Effect.succeed(\"gone\")) }", "error Gone\nerror Slow\neffect function find(n: number): string!(Gone | Slow) { if (n < 0) throw new Slow(); throw new Gone() }\nexport effect function partial(n: number) { return find(n) catch effect (e) => match (e) { when { _tag: \"Gone\" }: \"gone\"; default: throw e; } }"},
		// EK4836 (D290)
		{"withSpan", 4836, "effect function find() { return 1 }\nexport effect function traced() { return try Effect.withSpan(find(), \"find\") }", "effect function find() { return 1 }\nexport effect function traced() { return try withSpan(find(), \"find\") }"},
		{"withSpan that builds a program", 4836, "effect function find() { return 1 }\nexport function traced() { return Effect.withSpan(find(), \"find\") }", "effect function find() { return 1 }\nexport function traced() { return withSpan(find(), \"find\") }"},
		{"withSpan of a program the file reassigns", 4836, "let job: number!! = effect { return 1 }\nexport function swap() { job = effect { return 2 } }\nexport function traced() { return Effect.withSpan(job, \"job\") }", "let job: number!! = effect { return 1 }\nexport function swap() { job = effect { return 2 } }\nexport function traced() { return withSpan(job, \"job\") }"},
		{"provide", 4836, "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\neffect function name() { return try (try Region).name() }\nexport effect function region() {\n  return try Effect.provide(name(), RegionLive)\n}", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\neffect function name() { return try (try Region).name() }\nexport effect function region() {\n  provide RegionLive { return try name() }\n}"},
		{"provide as a statement", 4836, "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\neffect function name() { return try (try Region).name() }\nexport effect function region() {\n  try Effect.provide(name(), RegionLive)\n}", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\neffect function name() { return try (try Region).name() }\nexport effect function region() {\n  provide RegionLive { try name() }\n}"},
		{"provide a const program", 4836, "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\nconst app: string!!Region = effect { return try (try Region).name() }\nexport effect function region() {\n  return try Effect.provide(app, RegionLive)\n}", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\nconst app: string!!Region = effect { return try (try Region).name() }\nexport effect function region() {\n  provide RegionLive { return try app }\n}"},
		{"provide a parameter program", 4836, "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\nexport effect function region(app: string!!Region) {\n  return try Effect.provide(app, RegionLive)\n}", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { effect name() { return \"eu\" } })\nexport effect function region(app: string!!Region) {\n  provide RegionLive { return try app }\n}"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := applyQuickFix(t, test.source, test.code)
			if got != test.want {
				t.Fatalf("edited source differs:\ngot:\n%s\nwant:\n%s", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			for _, d := range all {
				if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && d.Code() == test.code {
					t.Errorf("the fixed source reports %s %d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}

// applyQuickFix returns source with the quick fix of its diagnostic code
// applied, through the language service's public code action request.
func applyQuickFix(t *testing.T, source string, code int32) string {
	t.Helper()
	return applyQuickFixOf(t, source, code, diagnostics.CategoryWarning)
}

// applyQuickFixOf is applyQuickFix for a diagnostic of category.
func applyQuickFixOf(t *testing.T, source string, code int32, category diagnostics.Category) string {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	var diagnostic *ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == code {
			diagnostic = d
			break
		}
	}
	if diagnostic == nil {
		t.Fatalf("missing EK%d in:\n%s", code, source)
	}
	if diagnostic.Category() != category {
		t.Fatalf("EK%d is %v, want %v", code, diagnostic.Category(), category)
	}
	d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
		Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
	})
	if err != nil {
		t.Fatal(err)
	}
	var chosen *lsproto.CodeAction
	if response.CommandOrCodeActionArray != nil {
		for _, action := range *response.CommandOrCodeActionArray {
			if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Write ") {
				chosen = action.CodeAction
			}
		}
	}
	if chosen == nil || chosen.Edit == nil || chosen.Edit.Changes == nil {
		t.Fatalf("no quick fix for EK%d", code)
	}
	changes := *chosen.Edit.Changes
	if len(changes) != 1 {
		t.Fatalf("the fix edits other documents: %v", changes)
	}
	return applyEditorEdits(t, file, converters, changes[lsconv.FileNameToDocumentURI(file.FileName())])
}

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
		{"service with a named shape", "interface Shape { read(): string!! }\nexport class Named extends Context.Service<Named, Shape>()(\"app/Named\") {}", 4831, "its members come from Shape"},
		{"service with a plain method", `export class Plain extends Context.Service<Plain, { read(): string }>()("app/Plain") {}`, 4831, "an operation of a service returns an Effect type"},
		{"service of a number", `export class Port extends Context.Service<Port, number>()("app/Port") {}`, 4831, ""},
		{"struct with optionalKey", `export const Exact = Schema.Struct({ id: Schema.optionalKey(Schema.String) })`, 4832, ""},
		{"struct with an annotation", `export const Named = Schema.Struct({ id: Schema.String }).annotate({ identifier: "Named" })`, 4832, ""},
		{"struct whose name is another type", "type Point = { x: number }\nexport const Point = Schema.Struct({ x: Schema.Number })", 4832, ""},
		{"union member retains its qualified contract", "export type Maybe = Effect.Effect<number> | undefined", 4833, "preserve grouping and declaration output"},
		{"function slot retains its qualified contract", "export type Make = Effect.Effect<() => number>", 4833, "preserve grouping and declaration output"},
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
			case test.why != "":
				notes := ""
				for _, chained := range found.MessageChain() {
					notes += chained.String() + "\n"
				}
				if !strings.Contains(notes, "No quick fix") || !strings.Contains(notes, test.why) {
					t.Fatalf("EK%d's note %q does not say %q", test.code, notes, test.why)
				}
			}
		})
	}
}

// D241: the rules are adjustable lint, so a directive or the project's
// setting turns one off, and a warning never becomes an error by itself.
// Chapter 007 / teaching forms are configurable default warnings: docs/design/src/007-tooling.md#fcbb4213812bb3d3
func TestTypeScriptFormDirectives(t *testing.T) {
	source := "// @vibelang-diagnostics-next-line EK4833:off\nexport type A = Effect.Effect<number>\nexport type B = Effect.Effect<number>\n"
	program, file, _, _ := editorProgram(t, source)
	var lines []int
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == 4833 {
			line, _ := scannerLineOf(file, d.Pos())
			lines = append(lines, line)
		}
	}
	if !slices.Equal(lines, []int{2}) {
		t.Fatalf("EK4833 on lines %v, want only line 2 (0-based)", lines)
	}
	for _, m := range tsFormMessages {
		if !slices.Contains(core.VibeLangAdjustableCodes, m.String()) {
			t.Errorf("%s is not adjustable", m)
		}
		if m.Category != diagnostics.CategoryWarning || m.Off {
			t.Errorf("%s is not a warning by default", m)
		}
	}
}

// The fixed twin of each tsforms-* case is what vibelang --fix writes for it
// (D291), and fixing the twin changes nothing. The smoke harness runs both
// and checks that they return the same result.
// In a project that emits declarations, EK4832 leaves an exported struct
// constant that declares no type of its name: a schema declaration would add
// the type to the declaration file, which the TypeScript did not export
// (D501). With the struct's own type beside it, the pair becomes the
// declaration, which declares the same two names.
// Chapter 007 / schema teaching retains the original declaration surface: docs/design/src/007-tooling.md#6c87e5c10fe11c76
func TestSchemaConstantKeepsDeclarations(t *testing.T) {
	source := `export const Snapshot = Schema.Struct({ value: Schema.String })

export const Pair = Schema.Struct({ left: Schema.Number })
export type Pair = typeof Pair.Type

const Local = Schema.Struct({ id: Schema.String })
export const decode = Schema.decodeUnknownSync(Local)
`
	want := `export const Snapshot = Schema.Struct({ value: Schema.String })

export schema Pair { readonly left: number }

schema Local { readonly id: string }
export const decode = Schema.decodeUnknownSync(Local)
`
	for _, options := range []string{`"declaration":true,"emitDeclarationOnly":true,"outDir":"out"`, `"noEmit":true`} {
		_, file, _, _ := editorProgram(t, source)
		dir := filepath.Dir(file.FileName().AsString())
		if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,`+options+`},"files":["main.vibe"]}`), 0o600); err != nil {
			t.Fatal(err)
		}
		result := fixCase(t, dir)
		got := source
		if fixed := result.Files[file.FileName()]; fixed != nil {
			got = fixed.Text
		}
		expected := want
		if options == `"noEmit":true` {
			expected = strings.Replace(want, "export const Snapshot = Schema.Struct({ value: Schema.String })", "export schema Snapshot { readonly value: string }", 1)
		}
		if got != expected || len(result.Refused) != 0 {
			t.Errorf("%s: --fix wrote\n%s\nwant\n%s\nrefused %+v", options, got, expected, result.Refused)
		}
	}
}

// A documented own type, type X = typeof X.Type under its own JSDoc, stays
// beside the schema declaration: "One written, nongeneric type X = typeof
// X.Type in the same scope replaces the synthesized alias" and keeps its own
// JSDoc (VIP-15, detail 256), so the declaration file documents the constant
// and the type as the native pair did. foldkit's canvas/shape.ts documents
// both names with one text and runtime/modelPreservation.ts with two. An
// undocumented own type goes as before, a documented own type spelled
// Schema.Schema.Type<typeof X> keeps the constant, and the alias form
// (EK4841, which still keeps a documented constant) keeps a documented own
// type the same way.
func TestSchemaConstantKeepsDocumentedType(t *testing.T) {
	source := `/** A 2D point in canvas-local coordinates. */
export const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number })
/** A 2D point in canvas-local coordinates. */
export type Point = typeof Point.Type

/** The preserved model, as stored. */
const Preserved = Schema.Struct({ version: Schema.Number })
/** The decoded preserved model. */
type Preserved = typeof Preserved.Type

/** Documented on the constant alone. */
export const Bare = Schema.Struct({ id: Schema.String })
export type Bare = typeof Bare.Type

export const Spelled = Schema.Struct({ id: Schema.String })
/** A spelled own type keeps its constant. */
export type Spelled = Schema.Schema.Type<typeof Spelled>

export const Port = Schema.Number
/** One port. */
export type Port = typeof Port.Type

export const decode = Schema.decodeUnknownSync(Preserved)
`
	want := `/** A 2D point in canvas-local coordinates. */
export schema Point { x: number; y: number }
/** A 2D point in canvas-local coordinates. */
export type Point = typeof Point.Type

/** The preserved model, as stored. */
schema Preserved { version: number }
/** The decoded preserved model. */
type Preserved = typeof Preserved.Type

/** Documented on the constant alone. */
export schema Bare { id: string }

export const Spelled = Schema.Struct({ id: Schema.String })
/** A spelled own type keeps its constant. */
export type Spelled = Schema.Schema.Type<typeof Spelled>

export schema Port = number
/** One port. */
export type Port = typeof Port.Type

export const decode = Schema.decodeUnknownSync(Preserved)
`
	for _, options := range []string{`"declaration":true,"emitDeclarationOnly":true,"outDir":"out"`, `"noEmit":true`} {
		_, file, _, _ := editorProgram(t, source)
		dir := filepath.Dir(file.FileName().AsString())
		if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,`+options+`},"files":["main.vibe"]}`), 0o600); err != nil {
			t.Fatal(err)
		}
		result := fixCase(t, dir)
		got := source
		if fixed := result.Files[file.FileName()]; fixed != nil {
			got = fixed.Text
		}
		if got != want || len(result.Refused) != 0 {
			t.Errorf("%s: --fix wrote\n%s\nwant\n%s\nrefused %+v", options, got, want, result.Refused)
		}
	}
}

func TestTypeScriptFormCasesFix(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	cases := filepath.Join(root, "typescript/vibelang/cases")
	names, err := filepath.Glob(filepath.Join(cases, "tsforms-*"))
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, fixture := range names {
		if strings.HasSuffix(fixture, "-fixed") {
			continue
		}
		twin := fixture + "-fixed"
		if _, err := os.Stat(twin); err != nil {
			t.Errorf("%s has no fixed twin", filepath.Base(fixture))
			continue
		}
		count++
		t.Run(filepath.Base(fixture), func(t *testing.T) {
			result := fixCase(t, copyCompilerFixture(t, fixture, root))
			sources, _ := filepath.Glob(filepath.Join(fixture, "*.vibe"))
			for _, source := range sources {
				want, err := os.ReadFile(filepath.Join(twin, filepath.Base(source)))
				if err != nil {
					t.Fatal(err)
				}
				original, _ := os.ReadFile(source)
				got := string(original)
				for name, fixed := range result.Files {
					if filepath.Base(name.AsString()) == filepath.Base(source) {
						got = fixed.Text
					}
				}
				if got != string(want) {
					t.Errorf("%s: --fix writes\n%s\nwant\n%s", filepath.Base(source), got, want)
				}
			}
			if len(result.Refused) != 0 {
				t.Errorf("refused: %v", result.Refused)
			}
			again := fixCase(t, copyCompilerFixture(t, twin, root))
			if len(again.Files) != 0 {
				t.Errorf("fixing the twin again changes %v", again.Order)
			}
		})
	}
	if count == 0 {
		t.Fatal("no tsforms cases")
	}
}

// fixCase runs FixProject on the case copied to dir.
func fixCase(t *testing.T, dir string) *FixResult {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return FixProject(t.Context(), fs, bundled.LibPath(), config)
}

// A fix that would add an error is refused, and the file keeps its other
// fixes: try Effect.succeed("fast") is a string, while the literal
// alone has the type "fast", which a later push of "slow" does not fit.
func TestFixProjectRefusesNewErrors(t *testing.T) {
	_, file, _, _ := editorProgram(t, "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  all.push(\"slow\")\n  return all\n}\nexport type B = Effect.Effect<number>\n")
	dir := filepath.Dir(file.FileName().AsString())
	result := fixCase(t, dir)
	if len(result.Refused) != 1 || result.Refused[0].Code != 4834 || result.Refused[0].Line != 2 || !strings.Contains(result.Refused[0].Error, "TS2345") {
		t.Fatalf("refused %+v, want EK4834 on line 2 with TS2345", result.Refused)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Counts[4833] != 1 || !strings.Contains(fixed.Text, "export type B = number!!") || !strings.Contains(fixed.Text, "Effect.succeed(\"fast\")") {
		t.Fatalf("fixed %+v, want only the EK4833 fix", fixed)
	}
	var report strings.Builder
	result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
	if want := "vibelang --fix: main.vibe:2: EK4834 not fixed: the fixed program would report"; !strings.Contains(report.String(), want) {
		t.Fatalf("report %q lacks %q", report.String(), want)
	}
	again := fixCase(t, dir) // the files on disk are unchanged: FixProject writes nothing
	if len(again.Refused) != 1 || len(again.Files) != 1 {
		t.Fatalf("a second dry run differs: %+v", again)
	}
}

// The command line drops --fix and refuses the modes it cannot serve.
func TestFixArguments(t *testing.T) {
	rest, ok := FixArguments([]string{"-p", "tsconfig.json", "--fix", "--noEmit"})
	if !ok || !slices.Equal(rest, []string{"-p", "tsconfig.json", "--noEmit"}) {
		t.Fatalf("FixArguments = %v, %v", rest, ok)
	}
	if _, ok := FixArguments([]string{"-p", "."}); ok {
		t.Fatal("found --fix in a command line without it")
	}
}

// Chapter 28 makes --fix a VibeLang flag, including when it is repeated.
func TestFixArgumentsRepeated(t *testing.T) {
	args := []string{"--fix", "-p", "tsconfig.json", "--FIX", "--noEmit", "--Fix"}
	rest, ok := FixArguments(args)
	if !ok || !slices.Equal(rest, []string{"-p", "tsconfig.json", "--noEmit"}) {
		t.Fatalf("FixArguments = %v, %v", rest, ok)
	}
	if !slices.Equal(args, []string{"--fix", "-p", "tsconfig.json", "--FIX", "--noEmit", "--Fix"}) {
		t.Fatalf("FixArguments changed its input: %v", args)
	}
}
