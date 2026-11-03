package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// legacyRunsPrelude declares what the position cases call: an Effect
// function, a plain function, and a plain function that returns an Effect.
const legacyRunsPrelude = `error Missing { id: number }

effect function load(n: number) {
  try yieldNow()
  return n
}

function plainId(n: number): number {
  return n
}

function factory(n: number) {
  return Effect.succeed(n * 10)
}

`

// Before VIP-1 a call in effect code whose result was an Effect ran where it
// stood, in every position below; after it, only try runs one. The VIP-1
// migration keeps each old run phase by writing try (decided detail 274), and
// writes none where the old compiler held the call or passed it by name. Each
// case is a legacy program and what --fix-vip-only writes. foldkit-18's None
// arm, `when Option.None: die(new Error("missing"))`, drew only EK4802 and no
// fix on the flip. A known legacy plain-variant wrapper whose result is
// success data loses its try instead, by the same detail: try make() ran an
// Effect function to get make's error instance as data, and the plain call
// gives it.
func TestFixVIPLegacyRunPositions(t *testing.T) {
	for _, c := range []struct{ name, legacy, want string }{
		{"statement", "effect function f() {\n  load(1)\n  return 0\n}\n", "effect function f() {\n  try load(1)\n  return 0\n}\n"},
		{"initializer", "effect function f() {\n  const a = load(2)\n  return a + 1\n}\n", "effect function f() {\n  const a = try load(2)\n  return a + 1\n}\n"},
		{"return", "effect function f() {\n  return load(3)\n}\n", "effect function f() {\n  return try load(3)\n}\n"},
		{"conditional-arms", "effect function f(c: boolean) {\n  return c ? load(4) : load(5)\n}\n", "effect function f(c: boolean) {\n  return c ? try load(4) : try load(5)\n}\n"},
		{"conditional-initializer", "effect function f(c: boolean) {\n  const v = c ? load(4) : 0\n  return v + 1\n}\n", "effect function f(c: boolean) {\n  const v = c ? try load(4) : 0\n  return v + 1\n}\n"},
		{"nullish", "effect function f(x: number | undefined) {\n  return x ?? load(6)\n}\n", "effect function f(x: number | undefined) {\n  return x ?? try load(6)\n}\n"},
		{"or", "effect function f(x: number) {\n  return x || load(7)\n}\n", "effect function f(x: number) {\n  return x || try load(7)\n}\n"},
		{"and", "effect function f(x: number) {\n  return x && load(8)\n}\n", "effect function f(x: number) {\n  return x && try load(8)\n}\n"},
		{"match-arm", "effect function f(o: Option.Option<number>) {\n  const v = match (o) {\n    when Option.None: load(9);\n    when Option.Some(let n): n;\n  }\n  return v + 1\n}\n", "effect function f(o: Option.Option<number>) {\n  const v = match (o) {\n    when Option.None: try load(9);\n    when Option.Some(let n): n;\n  }\n  return v + 1\n}\n"},
		{"match-arm-die", "effect function f(input: Option.Option<{ run: () => void }>) {\n  const found = match (input) {\n    when Option.None: die(new Error(\"missing\"));\n    when Option.Some(let value): value;\n  }\n  try sync((found) => found.run(), found)\n}\n", "effect function f(input: Option.Option<{ run: () => void }>) {\n  const found = match (input) {\n    when Option.None: try die(new Error(\"missing\"));\n    when Option.Some(let value): value;\n  }\n  try sync((found) => found.run(), found)\n}\n"},
		{"match-arm-returned", "effect function f(o: Option.Option<number>) {\n  return match (o) {\n    when Option.None: Effect.fail(new Missing({ id: 0 }));\n    when Option.Some(let n): n;\n  }\n}\n", "effect function f(o: Option.Option<number>) {\n  return match (o) {\n    when Option.None: try Effect.fail(new Missing({ id: 0 }));\n    when Option.Some(let n): n;\n  }\n}\n"},
		{"if-else-arms", "effect function f(c: boolean) {\n  if (c) load(10)\n  else load(11)\n  return 0\n}\n", "effect function f(c: boolean) {\n  if (c) try load(10)\n  else try load(11)\n  return 0\n}\n"},
		{"do-result", "effect function f() {\n  const v = do {\n    const x = 11\n    load(x)\n  }\n  return v + 1\n}\n", "effect function f() {\n  const v = do {\n    const x = 11\n    try load(x)\n  }\n  return v + 1\n}\n"},
		{"effect-arrow-body", "const f = effect (n: number) => load(n)\n", "const f = effect (n: number) => try load(n)\n"},
		{"subtype-tag-suspended", "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const stmt: (parts: TemplateStringsArray) => Statement\ndeclare const held: Statement\ndeclare const make: () => Statement\neffect function f() {\n  return try Effect.suspend(effect () => stmt`a`)\n}\n", "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const stmt: (parts: TemplateStringsArray) => Statement\ndeclare const held: Statement\ndeclare const make: () => Statement\neffect function f() {\n  return try Effect.suspend(effect () => try stmt`a`)\n}\n"},
		{"subtype-call-suspended", "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const stmt: (parts: TemplateStringsArray) => Statement\ndeclare const held: Statement\ndeclare const make: () => Statement\neffect function f() {\n  return try Effect.suspend(effect () => make())\n}\n", "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const stmt: (parts: TemplateStringsArray) => Statement\ndeclare const held: Statement\ndeclare const make: () => Statement\neffect function f() {\n  return try Effect.suspend(effect () => try make())\n}\n"},
		{"subtype-value-suspended", "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const stmt: (parts: TemplateStringsArray) => Statement\ndeclare const held: Statement\ndeclare const make: () => Statement\neffect function f() {\n  return try Effect.suspend(effect () => held)\n}\n", "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const stmt: (parts: TemplateStringsArray) => Statement\ndeclare const held: Statement\ndeclare const make: () => Statement\neffect function f() {\n  return try Effect.suspend(effect () => try held)\n}\n"},
		{"subtype-returned-suspended", "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const stmt: (parts: TemplateStringsArray) => Statement\ndeclare const held: Statement\ndeclare const make: () => Statement\neffect function f() {\n  return try Effect.suspend(effect () => {\n    return make()\n  })\n}\n", "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const stmt: (parts: TemplateStringsArray) => Statement\ndeclare const held: Statement\ndeclare const make: () => Statement\neffect function f() {\n  return try Effect.suspend(effect () => {\n    return try make()\n  })\n}\n"},
		{"subtype-arms-suspended", "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const stmt: (parts: TemplateStringsArray) => Statement\ndeclare const held: Statement\ndeclare const make: () => Statement\neffect function f(c: boolean) {\n  return try Effect.suspend(effect () => c ? make() : held)\n}\n", "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const stmt: (parts: TemplateStringsArray) => Statement\ndeclare const held: Statement\ndeclare const make: () => Statement\neffect function f(c: boolean) {\n  return try Effect.suspend(effect () => c ? try make() : try held)\n}\n"},
		{"effect-arrow-conditional", "const f = effect (c: boolean) => c ? load(12) : load(13)\n", "const f = effect (c: boolean) => c ? try load(12) : try load(13)\n"},
		{"argument", "effect function f() {\n  return plainId(load(16))\n}\n", "effect function f() {\n  return plainId(try load(16))\n}\n"},
		{"member", "effect function f() {\n  return load(17).toFixed()\n}\n", "effect function f() {\n  return (try load(17)).toFixed()\n}\n"},
		{"template", "effect function f() {\n  return `${load(18)}`\n}\n", "effect function f() {\n  return `${try load(18)}`\n}\n"},
		{"plain-factory", "effect function f() {\n  return factory(19)\n}\n", "effect function f() {\n  return try factory(19)\n}\n"},
		{"by-name-argument", "effect function f() {\n  return Effect.map(load(20), (n) => n + 1)\n}\n", "effect function f() {\n  return try Effect.map(load(20), (n) => n + 1)\n}\n"},
		{"elements", "effect function f() {\n  return [load(21), load(22)]\n}\n", "effect function f() {\n  return [try load(21), try load(22)]\n}\n"},
		{"catch-handler", "effect function f() {\n  return Effect.fail(new Missing({ id: 24 })) catch (e) => load(e.id)\n}\n", "effect function f() {\n  return Effect.fail(new Missing({ id: 24 })) catch effect (e) => try load(e.id)\n}\n"},
		{"catch-handler-block", "effect function f() {\n  return Effect.fail(new Missing({ id: 25 })) catch (e) => {\n    load(1)\n    return load(e.id)\n  }\n}\n", "effect function f() {\n  return Effect.fail(new Missing({ id: 25 })) catch effect (e) => {\n    try load(1)\n    return try load(e.id)\n  }\n}\n"},
		{"catch-fallback", "effect function f() {\n  return Effect.fail(new Missing({ id: 26 })) catch load(26)\n}\n", "effect function f() {\n  return Effect.fail(new Missing({ id: 26 })) catch effect () => try load(26)\n}\n"},
		{"unmarked-declaration", "function helper() {\n  load(1)\n  return 2\n}\n\neffect function f() {\n  return helper() + 1\n}\n", "effect function helper() {\n  try load(1)\n  return 2\n}\n\neffect function f() {\n  return try helper() + 1\n}\n"},
		{"inferred-arrow", "const g = (n: number) => {\n  const v = load(n)\n  return v + 1\n}\n\neffect function f() {\n  return g(1)\n}\n", "const g = effect (n: number) => {\n  const v = try load(n)\n  return v + 1\n}\n\neffect function f() {\n  return try g(1)\n}\n"},
		{"plain-variant-wrapper", "function make() {\n  return new Missing({ id: 27 })\n}\n\nclass Box {\n  build() {\n    return new Missing({ id: 28 })\n  }\n}\n\neffect function f() {\n  const e = try make()\n  const b = try new Box().build()\n  return [e.id, b.id]\n}\n", "function make() {\n  return new Missing({ id: 27 })\n}\n\nclass Box {\n  build() {\n    return new Missing({ id: 28 })\n  }\n}\n\neffect function f() {\n  const e = make()\n  const b = new Box().build()\n  return [e.id, b.id]\n}\n"},
		{"effect-callback", "effect function f() {\n  return Effect.flatMap(Effect.succeed(2), (n) => {\n    const v = load(n)\n    return Effect.succeed(v + 1)\n  })\n}\n", "effect function f() {\n  return try Effect.flatMap(Effect.succeed(2), effect (n) => {\n    const v = try load(n)\n    return try Effect.succeed(v + 1)\n  })\n}\n"},
		{"pipe-left-by-name", "effect function f() {\n  return load(1) |> Effect.map(%, (n) => n + 1)\n}\n", "effect function f() {\n  return load(1) |> try Effect.map(%, (n) => n + 1)\n}\n"},
		{"pipe-left-runs", "effect function f() {\n  return load(2) |> plainId(%)\n}\n", "effect function f() {\n  return try load(2) |> plainId(%)\n}\n"},
		{"inside-by-name", "effect function f() {\n  return Effect.map(factory(plainId(1) + load(1)), (n) => n + 1)\n}\n", "effect function f() {\n  return try Effect.map(effect { return try factory(plainId(1) + try load(1)) }, (n) => n + 1)\n}\n"},
		{"annotated-arrow", "const g = (n: number): number!! => {\n  const v = load(n)\n  return v + 1\n}\n\neffect function f() {\n  return g(1)\n}\n", "const g = effect (n: number): number!! => {\n  const v = try load(n)\n  return v + 1\n}\n\neffect function f() {\n  return try g(1)\n}\n"},
		{"held-field", "effect function f(): { fetch: number!! }!! {\n  return {\n    fetch: Effect.succeed(load(1) > 0 ? 1 : 2),\n  }\n}\n", "effect function f(): { fetch: number!! }!! {\n  return {\n    fetch: effect { return try Effect.succeed(try load(1) > 0 ? 1 : 2) },\n  }\n}\n"},
		{"pipe-chain-callback", "const run = (n: number) =>\n  Effect.succeed(n)\n  |> Effect.map(%, (x) => x + 1)\n  |> Effect.flatMap(%, (x) => Effect.succeed(x * 2))\n\neffect function f() {\n  return run(load(1))\n}\n", "const run = (n: number) =>\n  Effect.succeed(n)\n  |> Effect.map(%, (x) => x + 1)\n  |> Effect.flatMap(%, (x) => Effect.succeed(x * 2))\n\neffect function f() {\n  return try run(try load(1))\n}\n"},
		{"throwing-callback", "effect function f(n: number) {\n  return Effect.suspend(() => {\n    const r = n + 1\n    return r > 100 ? throw new Missing({ id: r }) : Effect.succeed(r)\n  })\n}\n", "effect function f(n: number) {\n  return try Effect.suspend(effect () => {\n    const r = n + 1\n    return r > 100 ? throw new Missing({ id: r }) : try Effect.succeed(r)\n  })\n}\n"},
		{"service-call-evidence", "service Clock2 {\n  now: () => number\n}\n\nconst stamp = (n: number): number!!Clock2 => {\n  const clock = Clock2()\n  return clock.now() + n\n}\n", "service Clock2 {\n  now: () => number\n}\n\nconst stamp = effect (n: number): number!!Clock2 => {\n  const clock = try Clock2\n  return clock.now() + n\n}\n"},
		{"program-literal", "const job: number!! = () => {\n  const v = load(1)\n  return v + 1\n}\n", "const job: number!! = effect {\n  const v = try load(1)\n  return v + 1\n}\n"},
		{"property", "effect function f() {\n  return { a: load(23) }\n}\n", "effect function f() {\n  return { a: try load(23) }\n}\n"},
		// foldkit-131: a literal passed where forkIn expects a program.
		{"program-literal-argument", "effect function f(scope: Scope) {\n  try forkIn(scope, () => load(1))\n}\n", "effect function f(scope: Scope) {\n  try forkIn(scope, effect { return try load(1) })\n}\n"},
		{"program-literal-argument-block", "effect function f(scope: Scope) {\n  try forkIn(scope, () => {\n    load(1)\n  })\n}\n", "effect function f(scope: Scope) {\n  try forkIn(scope, effect {\n    try load(1)\n  })\n}\n"},
		// foldkit-130: a catch expression is the only run of a function whose
		// form is effect.
		{"catch-annotated-arrow", "const parse = (n: number): number!! => Effect.fail(new Missing({ id: n })) catch () => 0\n", "const parse = effect (n: number): number!! => Effect.fail(new Missing({ id: n })) catch () => 0\n"},
		{"catch-bare-arrow", "const parse = (n: number) => Effect.fail(new Missing({ id: n })) catch () => 0\n", "const parse = effect (n: number) => Effect.fail(new Missing({ id: n })) catch () => 0\n"},
		{"catch-declaration", "function g(n: number) {\n  const a = Effect.fail(new Missing({ id: n })) catch () => 0\n  return a + 1\n}\n", "effect function g(n: number) {\n  const a = Effect.fail(new Missing({ id: n })) catch () => 0\n  return a + 1\n}\n"},
		// foldkit-17067: a catch in a plain factory, or at the top level, is
		// the program effect { return … } writes.
		{"catch-plain-factory", "const build = (trace: string[]): infer _ => {\n  trace.push(\"factory\")\n  const attempt: number!! = (effect {\n    trace.push(\"program\")\n    return 1\n  }) catch () => 0\n  return effect { return try attempt }\n}\n", "const build = (trace: string[]): infer _ => {\n  trace.push(\"factory\")\n  const attempt: number!! = effect { return (effect {\n    trace.push(\"program\")\n    return 1\n  }) catch () => 0 }\n  return effect { return try attempt }\n}\n"},
		{"catch-plain-call-operand", "const g = (n: number): infer _ => {\n  const p: number!! = Effect.fail(new Missing({ id: n })) catch () => 0\n  return p\n}\n", "const g = (n: number): infer _ => {\n  const p: number!! = effect { return Effect.fail(new Missing({ id: n })) catch () => 0 }\n  return p\n}\n"},
		// A catch at a held position in effect code was the program the
		// position received; drive-foldkit-web's playground witness.
		{"catch-held-argument", "function hold(p: number!!): number!! {\n  return p\n}\n\neffect function f() {\n  return hold(Effect.fail(new Missing({ id: 3 })) catch () => 0)\n}\n", "function hold(p: number!!): number!! {\n  return p\n}\n\neffect function f() {\n  return try hold(effect { return Effect.fail(new Missing({ id: 3 })) catch () => 0 })\n}\n"},
		{"catch-held-const", "effect function f() {\n  const p: number!! = Effect.fail(new Missing({ id: 4 })) catch () => 0\n  return try p\n}\n", "effect function f() {\n  const p: number!! = effect { return Effect.fail(new Missing({ id: 4 })) catch () => 0 }\n  return try p\n}\n"},
		{"catch-held-fibermap", "import { FiberMap } from 'effect'\nexport const program = (map: FiberMap.FiberMap<string>) => effect {\n  try FiberMap.run(\n    map, 'key',\n    (effect { throw 'expected' }) catch effect (error) => {\n      try Effect.logError(error)\n    },\n    { startImmediately: true },\n  )\n  return 'scheduled'\n}\n", "import { FiberMap } from 'effect'\nexport const program = (map: FiberMap.FiberMap<string>) => effect {\n  try FiberMap.run(\n    map, 'key',\n    effect { return (effect { throw 'expected' }) catch effect (error) => {\n      try Effect.logError(error)\n    } },\n    { startImmediately: true },\n  )\n  return 'scheduled'\n}\n"},
		// A call that ran inside a catch's head runs in the program the head
		// becomes (foldkit-17070, devtools-mcp relayRegistry.vibe:73).
		{"catch-head-nested-run", "effect function f(n: number) {\n  return plainId(load(n)) catch () => 0\n}\n", "effect function f(n: number) {\n  return (effect { return plainId(try load(n)) }) catch () => 0\n}\n"},
		{"catch-head-nested-run-held", "function hold(p: number!!): number!! {\n  return p\n}\n\neffect function f(n: number) {\n  return hold(plainId(load(n)) catch () => 0)\n}\n", "function hold(p: number!!): number!! {\n  return p\n}\n\neffect function f(n: number) {\n  return try hold(effect { return (effect { return plainId(try load(n)) }) catch () => 0 })\n}\n"},
		{"catch-head-foldkit-relay", "import { FileSystem } from \"effect\"\nconst decode = Schema.decodeUnknownOption(Schema.String)\nexport const read = effect (path: string): Option.Option<string>!!FileSystem.FileSystem => {\n  const fs = try FileSystem.FileSystem\n  return decode(fs.readFileString(path)) catch Option.none<string>()\n}\n", "import { FileSystem } from \"effect\"\nconst decode = Schema.decodeUnknownOption(Schema.String)\nexport const read = effect (path: string): Option.Option<string>!!FileSystem.FileSystem => {\n  const fs = try FileSystem.FileSystem\n  return (effect { return decode(try fs.readFileString(path)) }) catch () => Option.none<string>()\n}\n"},
		// A method of a service the old compiler read by calling it, as
		// const fs = FileSystem.FileSystem(), ran where it stood (foldkit
		// devtools-mcp relayRegistry.vibe readRecordFile, readLiveRecordFile).
		{"service-receiver-catch-head", "import { FileSystem } from \"effect\"\nconst decode = Schema.decodeUnknownOption(Schema.String)\nexport const read = (path: string): Option.Option<string>!!FileSystem.FileSystem => {\n  const fs = FileSystem.FileSystem()\n  return decode(fs.readFileString(path)) catch () => Option.none<string>()\n}\n", "import { FileSystem } from \"effect\"\nconst decode = Schema.decodeUnknownOption(Schema.String)\nexport const read = effect (path: string): Option.Option<string>!!FileSystem.FileSystem => {\n  const fs = try FileSystem.FileSystem\n  return (effect { return decode(try fs.readFileString(path)) }) catch () => Option.none<string>()\n}\n"},
		{"service-receiver-statement", "import { FileSystem } from \"effect\"\nexport const remove = (path: string): number!infer E!FileSystem.FileSystem => {\n  const fs = FileSystem.FileSystem()\n  fs.remove(path)\n  return 0\n}\n", "import { FileSystem } from \"effect\"\nexport const remove = effect (path: string): number!infer E!FileSystem.FileSystem => {\n  const fs = try FileSystem.FileSystem\n  try fs.remove(path)\n  return 0\n}\n"},
		{"catch-top-level", "export const p: number!! = Effect.fail(new Missing({ id: 1 })) catch () => 0\n", "export const p: number!! = effect { return Effect.fail(new Missing({ id: 1 })) catch () => 0 }\n"},
	} {
		t.Run(c.name, func(t *testing.T) {
			result, name := fixVIPOnlySource(t, legacyRunsPrelude+c.legacy)
			fixed := result.Files[name]
			want := legacyRunsPrelude + c.want
			if fixed == nil || fixed.Text != want {
				got := "(nothing)"
				if fixed != nil {
					got = fixed.Text
				}
				t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
			}
			if len(result.Refused) != 0 {
				t.Errorf("refused %+v", result.Refused)
			}
			again, _ := fixVIPOnlySource(t, want)
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Errorf("a second run wrote %d files and refused %+v", len(again.Files), again.Refused)
			}
		})
	}
}

// Where the old compiler decided by more than a call and its position, the
// migration doesn't guess (decided detail 274): an unmarked function passed
// as an argument took the form its parameter asked for, and an expression
// passed by name that holds a function of its own can't become an effect
// block without deciding that function's form. It writes nothing there and
// reports the line.
func TestFixVIPLegacyRunRefusals(t *testing.T) {
	for _, c := range []struct{ name, legacy, reason string }{
		{"callback", "effect function f() {\n  return [1].map((n) => {\n    load(n)\n    return n\n  })\n}\n", "inferred before VIP-1 from where it is passed"},
		{"inside-by-name-function", "effect function f() {\n  return Effect.map(factory(load(1) + [1].map((x) => load(x))[0]), (n) => n + 1)\n}\n", "passed by name"},
	} {
		t.Run(c.name, func(t *testing.T) {
			result, name := fixVIPOnlySource(t, legacyRunsPrelude+c.legacy)
			if fixed := result.Files[name]; fixed != nil && (strings.Contains(fixed.Text, "try load(1)") || strings.Contains(fixed.Text, "try load(n)")) {
				t.Errorf("wrote a try it can't establish:\n%s", fixed.Text)
			}
			if len(result.Refused) != 1 || result.Refused[0].Rewrite != tryLabel || !strings.Contains(result.Refused[0].Error, c.reason) {
				t.Fatalf("refused %+v; want one try refusal that says %q", result.Refused, c.reason)
			}
			var report strings.Builder
			result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
			if !strings.Contains(report.String(), "main.vibe:") || !strings.Contains(report.String(), ": try not written: ") {
				t.Errorf("report:\n%s", report.String())
			}
		})
	}
}

// fixVIPOnlySource runs --fix-vip-only on a project whose main.vibe is source.
func fixVIPOnlySource(t *testing.T, source string) (*FixResult, tspath.RootedFilePath) {
	return fixSourceOptions(t, source, FixOptions{VIPOnly: true})
}

func fixSourceOptions(t *testing.T, source string, options FixOptions) (*FixResult, tspath.RootedFilePath) {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options), file.FileName()
}

// The old compiler kept a returned Effect subtype as data under a written
// contract and with no call around the function (D24), so these keep it.
func TestFixVIPLegacySubtypeStaysData(t *testing.T) {
	const prelude = "interface Statement extends Effect.Effect<number> { readonly sql: string }\ndeclare const make: () => Statement\ndeclare const held: Statement\n"
	for _, source := range []string{
		"export const unmarked = effect () => make()\n",
		"export const unmarkedValue = effect () => held\n",
		"export const written = effect (): unknown!! => make()\n",
		"export const running = effect () => {\n  const statement = make()\n  return statement.sql\n}\n",
		"export const plainThunk = Effect.suspend(() => make())\n",
		"export const plainThunkValue = Effect.suspend(() => held)\n",
		"export const plainThunkBlock = Effect.suspend(() => {\n  return make()\n})\n",
		"export const plainHandler = (e: number!string) => Effect.catch(e, () => make())\n",
		"export const tried = effect () => try Effect.suspend(effect () => try make())\n",
	} {
		t.Run(strings.SplitN(source, " ", 4)[2], func(t *testing.T) {
			result, name := fixVIPOnlySource(t, prelude+source)
			if fixed := result.Files[name]; fixed != nil || len(result.Refused) != 0 {
				t.Fatalf("--fix-vip-only wrote %+v, refused %+v", fixed, result.Refused)
			}
		})
	}
}

// A position that held a call, as a declared Effect const, held it whatever
// form the old compiler gave the function around it, so the migration
// neither writes try nor refuses there (foldkit's website Command execute
// arrows: const program: void!never!never = pushUrl(url)). Calls inside
// try's own operand run where they stand, as in try (c ? effect {} :
// report(make())), rather than being held as a keyword form's operand.
func TestFixVIPLegacyHeldInAnnotatedArrow(t *testing.T) {
	source := legacyRunsPrelude + "const g = (n: number): number!! => {\n  const program: number!! = load(n)\n  return effect {\n    return try program\n  }\n}\n\neffect function f(c: boolean) {\n  return try (c ? effect { return 0 } : Effect.succeed(plainId(load(1))))\n}\n\neffect function piped() {\n  return try (effect { return plainId(load(3)) } |> Effect.orDie(%))\n}\n\neffect function report(d: number) {\n  try yieldNow()\n}\n\neffect function h(c: boolean) {\n  try (c ? effect {} : report(plainId(load(2))))\n}\n"
	result, name := fixVIPOnlySource(t, source)
	if len(result.Refused) != 0 {
		t.Fatalf("refused %+v", result.Refused)
	}
	want := strings.Replace(strings.Replace(source, "plainId(load(1))", "plainId(try load(1))", 1), "plainId(load(2))", "plainId(try load(2))", 1)
	want = strings.Replace(want, "plainId(load(3))", "plainId(try load(3))", 1)
	if fixed := result.Files[name]; fixed == nil || fixed.Text != want {
		t.Fatalf("--fix-vip-only wrote %+v, want\n%s", fixed, want)
	}
}

// vip1-legacy-runs.fail is a legacy program with a call in every position
// the old compiler ran; --fix-vip-only writes vip1-legacy-runs-fixed, whose
// expect-result is what the legacy program gave under the pre-flip
// compiler, apart from the expectation line.
func TestFixVIPLegacyRunsCase(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	cases := filepath.Join(root, "typescript/vibelang/cases")
	dir := copyCompilerFixture(t, filepath.Join(cases, "vip1-legacy-runs.fail"), root)
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	if len(result.Refused) != 0 || len(result.Files) != 1 {
		t.Fatalf("fix: %d files, refused %+v", len(result.Files), result.Refused)
	}
	var got string
	for _, fixed := range result.Files {
		got = fixed.Text
	}
	want, err := os.ReadFile(filepath.Join(cases, "vip1-legacy-runs-fixed/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	body := func(text string) string {
		_, rest, _ := strings.Cut(text, "\n")
		return rest
	}
	if body(got) != body(string(want)) {
		t.Fatalf("--fix-vip-only writes\n%s\nwant\n%s", got, want)
	}
}
