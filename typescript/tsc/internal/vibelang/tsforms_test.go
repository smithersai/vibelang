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
		{"generic error", 4830, `export class Boxed<T> extends Data.TaggedError("Boxed")<{ value: T }> {}`, `export error Boxed<T> { value: T }`},
		{"prelude TaggedError", 4830, `export class Gone extends TaggedError("Gone")<{ id: string }> {}`, `export error Gone { id: string }`},
		{"last use of the import", 4830, "import * as Data from \"effect/Data\"\n/** Gone. */\nexport class Gone extends Data.TaggedError(\"Gone\")<{ id: string }> {}", "/** Gone. */\nexport error Gone { id: string }"},
		// EK4831 (D285)
		{"service", 4831, "export class Users extends Context.Service<Users, {\n  find(id: string): Effect.Effect<string>\n  readonly region: string,\n  size: (name: string) => number!!\n}>()(\"app/Users\") {}", "export service Users {\n  static readonly key = \"app/Users\"\n  find(id: string): string!!\n  region: string\n  size: (name: string) => number!!\n}"},
		{"service with its type arguments on lines", 4831, "export class RenderCommit extends Context.Service<\n  RenderCommit,\n  {\n    readonly isCommitPending: () => boolean\n    readonly onNextCommit: (callback: () => void) => () => void\n  }\n>()(\"app/RenderCommit\") {}", "export service RenderCommit {\n  static readonly key = \"app/RenderCommit\"\n  isCommitPending: () => boolean\n  onNextCommit: (callback: () => void) => () => void\n}"},
		{"one-line service", 4831, `export class Clock2 extends Context.Service<Clock2, { now(): Effect.Effect<number, never, never>, zone: string }>()("app/Clock2") {}`, `export service Clock2 { static readonly key = "app/Clock2"; now(): number!!; zone: string }`},
		// EK4832 (D286)
		{"struct and its type", 4832, "export const User = Schema.Struct({ id: Schema.String, nickname: Schema.optional(Schema.String), role: Schema.Literals([\"admin\", \"member\"]) })\nexport type User = typeof User.Type\nexport const u: User = { id: \"1\", role: \"admin\" }", "export schema User { id: string; nickname?: string; role: \"admin\" | \"member\" }\nexport const u: User = { id: \"1\", role: \"admin\" }"},
		{"every field form", 4832, "export const Order = Schema.Struct({\n  items: Schema.Array(Schema.Union([Schema.String, Schema.Number])),\n  pair: Schema.Tuple([Schema.String, Schema.Boolean]),\n  tags: Schema.Record(Schema.String, Schema.Number),\n  status: Schema.mutableKey(Schema.Literal(\"open\")),\n  note: Schema.optional(Schema.Union([Schema.String, Schema.Null])),\n  meta: Schema.Struct({ ok: Schema.Boolean }),\n  count: Schema.Finite\n})", "export schema Order {\n  items: (string | number)[]\n  pair: [string, boolean]\n  tags: Record<string, number>\n  mutable status: \"open\"\n  note?: string | null\n  meta: { ok: boolean }\n  count: Schema.Finite\n}"},
		{"local struct", 4832, "export function decode(value: unknown) {\n  const Local = Schema.Struct({ value: Schema.String })\n  return Schema.decodeUnknownEffect(Local)(value)\n}", "export function decode(value: unknown) {\n  schema Local { value: string }\n  return Schema.decodeUnknownEffect(Local)(value)\n}"},
		// EK4833 (D287)
		{"full contract", 4833, `export function load(): Effect.Effect<number, never, never> { return 1 }`, `export function load(): number!! { return 1 }`},
		{"never dependencies in a body's return", 4833, "error Gone\nexport function load(): Effect.Effect<number, Gone, never> { return 1 }", "error Gone\nexport function load(): number!Gone { return 1 }"},
		{"parameter", 4833, `export function run(program: Effect.Effect<number>): number!! { return program() }`, `export function run(program: number!!): number!! { return program() }`},
		{"union member", 4833, `export type Maybe = Effect.Effect<number> | undefined`, `export type Maybe = (number!!) | undefined`},
		{"function slot", 4833, `export type Make = Effect.Effect<() => number>`, `export type Make = (() => number)!!`},
		{"partial contract on a body", 4833, `export function load(): Effect.Effect<number> { return 1 }`, `export function load(): number!! { return 1 }`},
		{"partial contract with errors on a body", 4833, "error Gone\nexport function load(): Effect.Effect<number, Gone> { return 1 }", "error Gone\nexport function load(): number!Gone { return 1 }"},
		// EK4834 (D288)
		{"succeed in a return", 4834, "export function find(id: number) {\n  if (id === 0) throw new Error(\"no\")\n  return Effect.succeed(\"Ada\")\n}", "export function find(id: number) {\n  if (id === 0) throw new Error(\"no\")\n  return \"Ada\"\n}"},
		{"fail in a return", 4834, "error Gone\nexport function find(id: number) {\n  if (id === 0) return Effect.fail(new Gone())\n  return 1\n}", "error Gone\nexport function find(id: number) {\n  if (id === 0) throw new Gone()\n  return 1\n}"},
		{"succeed in an Effect-typed arrow", 4834, "export const read: () => Effect.Effect<{ ok: boolean }> = () => Effect.succeed({ ok: true })", "export const read: () => Effect.Effect<{ ok: boolean }> = () => ({ ok: true })"},
		{"fail in an Effect-typed arrow", 4834, "error Gone\nexport const gone: () => Effect.Effect<never, Gone> = () => Effect.fail(new Gone())", "error Gone\nexport const gone: () => Effect.Effect<never, Gone> = () => throw new Gone()"},
		// EK4835 (D289)
		{"method catchTag", 4835, "error Gone { id: number }\nfunction find(id: number): string!Gone { throw new Gone({ id }) }\nexport function describe(id: number) { return find(id).pipe(Effect.catchTag(\"Gone\", (e) => Effect.succeed(\"gone \" + e.id))) }", "error Gone { id: number }\nfunction find(id: number): string!Gone { throw new Gone({ id }) }\nexport function describe(id: number) { return find(id) catch (e) => match (e) { when { _tag: \"Gone\" }: (\"gone \" + e.id); } }"},
		{"catchTag keeps succeed of a cold program", 4835, `error Gone
function fail() { throw new Gone() }
const job: number!! = () => 1
export function recover() { return Effect.catchTag(fail(), "Gone", () => Effect.succeed(job)) }`, `error Gone
function fail() { throw new Gone() }
const job: number!! = () => 1
export function recover() { return fail() catch (e) => match (e) { when { _tag: "Gone" }: Effect.succeed(job); } }`},
		{"catchTag simplifies succeed object", 4835, `error Gone
function fail() { throw new Gone() }
export function recover() { return Effect.catchTag(fail(), "Gone", () => Effect.succeed({ ok: true })) }`, `error Gone
function fail() { throw new Gone() }
export function recover() { return fail() catch (e) => match (e) { when { _tag: "Gone" }: ({ ok: true }); } }`},
		{"catch fallback simplifies conditional succeed", 4835, `error Gone
function fail() { throw new Gone() }
export function recover(flag: boolean) { return Effect.catch(fail(), () => Effect.succeed(flag ? 1 : 2)) }`, `error Gone
function fail() { throw new Gone() }
export function recover(flag: boolean) { return fail() catch (flag ? 1 : 2) }`},
		{"catchTag of a declared error", 4835, "error Gone { id: number }\nfunction find(id: number): string!Gone { throw new Gone({ id }) }\nexport function describe(id: number) { return Effect.catchTag(find(id), \"Gone\", (e) => `gone ${e.id}`) }", "error Gone { id: number }\nfunction find(id: number): string!Gone { throw new Gone({ id }) }\nexport function describe(id: number) { return find(id) catch (e) => match (e) { when { _tag: \"Gone\" }: `gone ${e.id}`; } }"},
		{"catchTags", 4835, "error Gone\nerror Slow\nfunction find(id: number): string!Gone | Slow { if (id < 0) throw new Slow(); throw new Gone() }\nexport function both(id: number) { return Effect.catchTags(find(id), { Gone: () => \"gone\", Slow: () => \"slow\" }) }", "error Gone\nerror Slow\nfunction find(id: number): string!Gone | Slow { if (id < 0) throw new Slow(); throw new Gone() }\nexport function both(id: number) { return find(id) catch (e) => match (e) { when { _tag: \"Gone\" }: \"gone\"; when { _tag: \"Slow\" }: \"slow\"; } }"},
		{"catchTag of a structural tag", 4835, "class Tagged { readonly _tag = \"Tagged\" as const }\nfunction fail(): string!Tagged { throw new Tagged() }\nexport function recover() { return Effect.catchTag(fail(), \"Tagged\", () => \"ok\") }", "class Tagged { readonly _tag = \"Tagged\" as const }\nfunction fail(): string!Tagged { throw new Tagged() }\nexport function recover() { return fail() catch (e) => match (e) { when { _tag: \"Tagged\" }: \"ok\"; } }"},
		{"catch with a handler", 4835, "error Gone\nfunction find(): string!Gone { throw new Gone() }\nexport function any() { return Effect.catch(find(), (e) => e._tag) }", "error Gone\nfunction find(): string!Gone { throw new Gone() }\nexport function any() { return find() catch (e) => e._tag }"},
		{"catch with a fallback", 4835, "error Gone\nfunction find(): string!Gone { throw new Gone() }\nexport function any() { return Effect.catch(find(), () => \"none\") }", "error Gone\nfunction find(): string!Gone { throw new Gone() }\nexport function any() { return find() catch \"none\" }"},
		{"catchTag of part of E", 4835, "error Gone\nerror Slow\nfunction find(n: number): string!Gone | Slow { if (n < 0) throw new Slow(); throw new Gone() }\nexport function partial(n: number) { return Effect.catchTag(find(n), \"Gone\", () => \"gone\") }", "error Gone\nerror Slow\nfunction find(n: number): string!Gone | Slow { if (n < 0) throw new Slow(); throw new Gone() }\nexport function partial(n: number) { return find(n) catch (e) => match (e) { when { _tag: \"Gone\" }: \"gone\"; default: throw e; } }"},
		// EK4836 (D290)
		{"withSpan", 4836, "function find() { return Effect.succeed(1) }\nexport function traced() { return Effect.withSpan(find(), \"find\") }", "function find() { return Effect.succeed(1) }\nexport function traced() { return withSpan(() => find(), \"find\") }"},
		{"provide", 4836, "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nexport function region() {\n  return Effect.provide(Region.name(), RegionLive)\n}", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nexport function region() {\n  provide RegionLive { return Region.name() }\n}"},
		{"provideService", 4836, "service Region { name(): string!! }\nexport function region() {\n  return Effect.provideService(Region.name(), Region, { name() { return \"eu\" } })\n}", "service Region { name(): string!! }\nexport function region() {\n  provide Region = { name() { return \"eu\" } } { return Region.name() }\n}"},
		{"provide a const program", 4836, "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nconst app: string!!Region = () => Region.name()\nexport function region() {\n  return Effect.provide(app, RegionLive)\n}", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nconst app: string!!Region = () => Region.name()\nexport function region() {\n  provide RegionLive { return app() }\n}"},
		{"provide a parameter program", 4836, "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nexport function region(app: string!!Region) {\n  return Effect.provide(app, RegionLive)\n}", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nexport function region(app: string!!Region) {\n  provide RegionLive { return app() }\n}"},
		{"withSpan of a cold program", 4836, "const job: number!! = () => 1\nexport function traced() { return Effect.withSpan(job, \"job\") }", "const job: number!! = () => 1\nexport function traced() { return withSpan(() => job(), \"job\") }"},
		{"withSpan of an arrow", 4836, "function find() { return Effect.succeed(1) }\nexport function traced() { return Effect.withSpan(() => find(), \"find\") }", "function find() { return Effect.succeed(1) }\nexport function traced() { return withSpan(() => find(), \"find\") }"},
		{"provide a lambda program", 4836, "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nexport function region() {\n  return Effect.provide(() => Region.name(), RegionLive)\n}", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nexport function region() {\n  provide RegionLive { return Region.name() }\n}"},
		{"catchTag of an arrow", 4835, "error Gone\nfunction find(id: string): number!Gone { if (id === \"x\") throw new Gone(); return 2 }\nexport function safe(id: string) { return Effect.catchTag(() => find(id), \"Gone\", () => 0) }", "error Gone\nfunction find(id: string): number!Gone { if (id === \"x\") throw new Gone(); return 2 }\nexport function safe(id: string) { return find(id) catch (e) => match (e) { when { _tag: \"Gone\" }: 0; } }"},
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
func TestTypeScriptFormRefusals(t *testing.T) {
	for _, test := range []struct {
		name   string
		source string
		code   int32
		why    string // the note of a warning without a fix, or "" for no warning
	}{
		{"error tag differs from the name", `export class Renamed extends Data.TaggedError("app/Renamed")<{ id: string }> {}`, 4830, `the tag would become "Renamed" instead of "app/Renamed"`},
		{"untagged Data.Error", `export class Untagged extends Data.Error<{ id: string }> {}`, 4830, `adds a _tag, "Untagged"`},
		{"Schema error", `export class Failed extends Schema.TaggedError<Failed>()("Failed", { id: Schema.String }) {}`, 4837, "is not a Schema"},
		{"fields from a named type", "interface Fields { id: string }\nexport class Named extends Data.TaggedError(\"Named\")<Fields> {}", 4830, "the fields come from Fields"},
		{"error class with members", `export class Custom extends Data.TaggedError("Custom")<{ id: string }> { get message() { return this.id } }`, 4830, ""},
		{"service with a named shape", "interface Shape { read(): string!! }\nexport class Named extends Context.Service<Named, Shape>()(\"app/Named\") {}", 4831, "its members come from Shape"},
		{"service with a plain method", `export class Plain extends Context.Service<Plain, { read(): string }>()("app/Plain") {}`, 4831, "an operation of a service returns an Effect type"},
		{"service of a number", `export class Port extends Context.Service<Port, number>()("app/Port") {}`, 4831, ""},
		{"struct with optionalKey", `export const Exact = Schema.Struct({ id: Schema.optionalKey(Schema.String) })`, 4832, ""},
		{"struct with an annotation", `export const Named = Schema.Struct({ id: Schema.String }).annotate({ identifier: "Named" })`, 4832, ""},
		{"struct whose name is another type", "type Point = { x: number }\nexport const Point = Schema.Struct({ x: Schema.Number })", 4832, ""},
		{"prelude spelling", `export type Load = (id: string) => Effect<string, never, never>`, 4833, ""},
		{"inferred requirements", `export function load(): Effect.Effect<number, never, infer R> { return 1 }`, 4833, ""},
		{"inferred errors", `export function load(): Effect.Effect<number, infer E, never> { return 1 }`, 4833, ""},
		{"succeed passed by name", `export function patient() { return retry(Effect.succeed(1), Schedule.recurs(1)) }`, 4834, ""},
		{"succeed of an Effect", "const inner: Effect.Effect<number> = Effect.sync(() => 1)\nexport function outer() { return Effect.succeed(inner) }", 4834, ""},
		{"succeed in a lambda whose form follows its body", `export const free = { run: () => Effect.succeed(1) } as unknown as { run: () => number!! }`, 4834, ""},
		{"fail of a Cause", `export function rethrow(cause: Cause.Cause<string>) { return Effect.fail(cause) }`, 4834, ""},
		{"catchTag with a block handler", "error Gone\nfunction find(): string!Gone { throw new Gone() }\nexport function f() { return Effect.catchTag(find(), \"Gone\", () => { const x = 1; return x }) }", 4835, ""},
		{"provide as a value", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nexport function region() {\n  const name = Effect.provide(Region.name(), RegionLive)\n  return name\n}", 4836, "a provide block stands only as a statement or a return"},
		{"provide of an arrow as a value", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nexport function region() {\n  const name = Effect.provide(() => Region.name(), RegionLive)\n  return name\n}", 4836, "a provide block stands only as a statement or a return"},
		// The VibeLang form already: the prelude's withSpan.
		{"prelude withSpan", "function find() { return Effect.succeed(1) }\nexport function traced() { return withSpan(find(), \"find\") }", 4836, ""},
		{"withSpan shadowed", "function withSpan(name: string) { return name }\nexport function f() { return Effect.withSpan(Effect.succeed(1), \"x\") }", 4836, ""},
		{"provide of a program read through a getter", "service Region { name(): string!! }\nconst RegionLive = Layer.succeed(Region, { name() { return \"eu\" } })\nconst holder = { get app(): string!!Region { return () => Region.name() } }\nexport function region() {\n  return Effect.provide(holder.app, RegionLive)\n}", 4836, "bind it to a const first"},
		{"provide of a program the file reassigns", "let job: number!! = () => 1\nexport function swap() { job = () => 2 }\nexport function run() {\n  return Effect.provide(job, Layer.empty)\n}", 4836, "bind it to a const first"},
		{"withSpan of a program a parameter is assigned", "export function traced(job: number!!) {\n  job = () => 2\n  return Effect.withSpan(job, \"job\")\n}", 4836, "bind it to a const first"},
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
func TestSchemaConstantKeepsDeclarations(t *testing.T) {
	source := `export const Snapshot = Schema.Struct({ value: Schema.String })

export const Pair = Schema.Struct({ left: Schema.Number })
export type Pair = typeof Pair.Type

const Local = Schema.Struct({ id: Schema.String })
export const decode = Schema.decodeUnknownSync(Local)
`
	want := `export const Snapshot = Schema.Struct({ value: Schema.String })

export schema Pair { left: number }

schema Local { id: string }
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
			expected = strings.Replace(want, "export const Snapshot = Schema.Struct({ value: Schema.String })", "export schema Snapshot { value: string }", 1)
		}
		if got != expected || len(result.Refused) != 0 {
			t.Errorf("%s: --fix wrote\n%s\nwant\n%s\nrefused %+v", options, got, expected, result.Refused)
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
// fixes: a running Effect.succeed("fast") is a string, while the literal
// alone has the type "fast", which a later push of "slow" does not fit.
func TestFixProjectRefusesNewErrors(t *testing.T) {
	_, file, _, _ := editorProgram(t, "export function modes() {\n  const mode = Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  all.push(\"slow\")\n  return all\n}\nexport type B = Effect.Effect<number>\n")
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
