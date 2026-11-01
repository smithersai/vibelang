package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const stageHeader = "const p = (n: number): Effect.Effect<number, string> => Effect.sync(() => n)\n"

// The rewrites of a pipeline's last stage and of a thunk: each result compiles
// and says what the source said, in VibeLang's form.
func TestEffectStageFixes(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"orElseSucceed returned", "export const f = (n: number) => p(n).pipe(Effect.orElseSucceed(() => 0))\n",
			"export const f = (n: number) => p(n) catch () => 0\n"},
		{"orElseSucceed under try", "export const f = (n: number) => Effect.gen(function* () {\n  const v = yield* p(n).pipe(Effect.orElseSucceed(() => 0))\n  return v\n})\n",
			"export const f = effect (n: number) => {\n  const v = p(n) catch () => 0\n  return v\n}\n"},
		{"an object fallback", "export const f = (n: number) => p(n).pipe(Effect.orElseSucceed(() => ({ n })))\n",
			"export const f = (n: number) => p(n) catch () => ({ n })\n"},
		{"mapError literal", "export const f = (n: number) => p(n).pipe(Effect.mapError((e) => e.length))\n",
			"export const f = (n: number) => p(n) catch effect (e) => { throw e.length }\n"},
		{"mapError by name", "const size = (e: string) => e.length\nexport const f = (n: number) => p(n).pipe(Effect.mapError(size))\n",
			"const size = (e: string): number => e.length\nexport const f = (n: number) => p(n) catch effect (e) => { throw size(e) }\n"},
		{"stages before it stay", "export const f = (n: number) => p(n).pipe(Effect.map((x) => x + 1), Effect.catch((e) => Effect.succeed(e.length)))\n",
			"export const f = (n: number) => (p(n) |> Effect.map(%, (x) => x + 1)) catch (e) => e.length\n"},
		{"catch under try drops the try", "export const f = (n: number) => Effect.gen(function* () {\n  const v = yield* Effect.catch(p(n), (e) => Effect.succeed(e.length))\n  return v\n})\n",
			"export const f = effect (n: number) => {\n  const v = p(n) catch (e) => e.length\n  return v\n}\n"},
		{"sync held", "export const v = Effect.sync(() => 1)\n", "export const v = effect { return 1 }\n"},
		{"sync block", "export const v = Effect.sync(() => {\n  // one\n  const a = 1\n  return a + 1\n})\n",
			"export const v = effect {\n  // one\n  const a = 1\n  return a + 1\n}\n"},
		{"sync returned", "export const f = (n: number) => Effect.sync(() => n + 1)\n", "export const f = effect (n: number) => n + 1\n"},
		{"sync block returned", "export const f = (n: number) => Effect.sync(() => {\n  const a = n\n  return a + 1\n})\n",
			"export const f = effect (n: number) => {\n  const a = n\n  return a + 1\n}\n"},
		{"sync of an object", "export const f = (n: number) => Effect.sync(() => ({ n }))\n", "export const f = effect (n: number) => ({ n })\n"},
		{"sync run", "export const f = (n: number) => Effect.gen(function* () {\n  const v = yield* Effect.sync(() => n + 1)\n  return v\n})\n",
			"export const f = effect (n: number) => {\n  const v = n + 1\n  return v\n}\n"},
		{"suspend returned", "export const f = (n: number) => Effect.suspend(() => p(n))\n", "export const f = effect (n: number) => try p(n)\n"},
		{"suspend run", "export const f = (n: number) => Effect.gen(function* () {\n  const v = yield* Effect.suspend(() => p(n))\n  return v\n})\n",
			"export const f = effect (n: number) => {\n  const v = try p(n)\n  return v\n}\n"},
		{"withSpan returned", "export const f = (n: number) => p(n).pipe(Effect.withSpan(\"load\"))\n",
			"export const f = (n: number) => withSpan(() => p(n), \"load\")\n"},
		{"withSpan run", "export const f = (n: number) => Effect.gen(function* () {\n  const v = yield* p(n).pipe(Effect.withSpan(\"load\"))\n  return v\n})\n",
			"export const f = effect (n: number) => {\n  const v = try withSpan(() => p(n), \"load\")\n  return v\n}\n"},
		{"provide run", "export const f = (n: number) => Effect.gen(function* () {\n  const v = yield* p(n).pipe(Effect.provide(Layer.empty))\n  return v\n})\n",
			"export const f = effect (n: number) => {\n  const v = try effect { provide Layer.empty { return try p(n) } }\n  return v\n}\n"},
		{"void statement", "export const f = (n: number) => Effect.gen(function* () {\n  yield* Effect.void\n  return n\n})\n",
			"export const f = effect (n: number) => {\n  return n\n}\n"},
		{"void returned", "export const f = (n: number) => Effect.gen(function* () {\n  if (n > 0) {\n    return yield* Effect.void\n  }\n  yield* p(n)\n})\n",
			"export const f = effect (n: number) => {\n  if (n > 0) {\n    return\n  }\n  try p(n)\n}\n"},
		{"suspend held", "export const v = Effect.suspend(() => p(1))\n", "export const v = effect { return try p(1) }\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source, want := stageHeader+test.source, "const p = (n: number): number!string => n\n"+test.want
			got, result := fixedPipe(t, source)
			if got != want {
				t.Fatalf("--fix writes\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
			}
			if again, _ := fixedPipe(t, got); again != got {
				t.Fatalf("--fix is not idempotent:\n%s\nthen\n%s", got, again)
			}
		})
	}
}

// Each stays: a catch expression would run a program this source holds, or a
// block would mean something else.
func TestEffectStageFixesRefuse(t *testing.T) {
	for _, test := range []struct{ name, source, kept string }{
		{"a stage with stages after it", "export const f = (n: number) => p(n).pipe(Effect.orElseSucceed(() => 0), Effect.map((x) => x + 1))\n", "Effect.orElseSucceed(%"},
		{"a pipeline held as a value", "export const f = (n: number) => {\n  const q = p(n) |> Effect.mapError(%, (e) => e.length)\n  return [q]\n}\n", "Effect.mapError(%"},
		{"a pipeline passed", "export const f = (n: number) => Effect.all([p(n) |> Effect.orElseSucceed(%, () => 0)])\n", "Effect.orElseSucceed(%"},
		{"a fallback that is a program", "export const f = (n: number) => p(n).pipe(Effect.orElseSucceed(() => Effect.succeed(1)))\n", "Effect.orElseSucceed(%"},
		{"a handler with a default", "export const f = (n: number) => p(n).pipe(Effect.mapError((e = \"x\") => e))\n", "Effect.mapError(%"},
		{"a span with options", "export const f = (n: number) => p(n).pipe(Effect.withSpan(\"load\", { attributes: { n } }))\n", "Effect.withSpan(%"},
		{"a provide no try runs", "export const f = (n: number) => p(n).pipe(Effect.provide(Layer.empty))\n", "Effect.provide(%"},
		{"a sync a statement returns", "export function f(n: number) {\n  return Effect.sync(() => n)\n}\n", "Effect.sync("},
		{"a sync of a program", "export const f = (n: number) => Effect.sync(() => p(n))\n", "Effect.sync("},
		{"a sync that reads this", "export class C {\n  n = 1\n  get() { return Effect.sync(() => this.n) }\n}\n", "Effect.sync("},
		{"a suspend of a block", "export const f = (n: number) => Effect.suspend(() => {\n  if (n > 0) return p(n)\n  return p(0)\n})\n", "Effect.suspend("},
		{"a thunk by name", "const thunk = () => 1\nexport const v = Effect.sync(thunk)\n", "Effect.sync(thunk"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, _ := fixedPipe(t, stageHeader+test.source)
			if !strings.Contains(got, test.kept) {
				t.Fatalf("--fix writes\n%s\nwant it to keep %s", got, test.kept)
			}
		})
	}
}

// Effect.sync is the boundary of a TypeScript call: its exceptions are defects
// there, and EK4401 reports the call in a block (opencode m7 r1).
func TestThunkKeepsTypeScriptCall(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"a call", "export const v = Effect.sync(() => label())\n", "Effect.sync(() => label())"},
		{"a call in a block", "export const v = Effect.sync(() => {\n  const a = label()\n  return a\n})\n", "const a = label()\n  return a\n})"},
		{"an argument", "export const v = Effect.sync(() => [label()])\n", "Effect.sync(() => [label()])"},
		{"a built-in that lists its failures", "export const f = (s: string) => Effect.sync(() => JSON.parse(s))\n", "Effect.sync(() => JSON.parse(s))"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "import { label } from \"./lib.ts\"\n" + test.source
			_, file, _, _ := editorProgram(t, source)
			dir := filepath.Dir(file.FileName().AsString())
			if err := os.WriteFile(filepath.Join(dir, "lib.ts"), []byte("export const label = (): string => \"x\"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			result := fixCase(t, dir)
			got := source
			if fixed := result.Files[file.FileName()]; fixed != nil {
				got = fixed.Text
			}
			if !strings.Contains(got, test.want) {
				t.Fatalf("--fix writes\n%s\nwant it to hold %s\nrefused %+v", got, test.want, result.Refused)
			}
			for _, refused := range result.Refused {
				if refused.Code == 4834 {
					t.Fatalf("the rule proposed what the gate refused: %+v", refused)
				}
			}
		})
	}
}

// A branch of a function whose inferred return type is a union of Effects stays
// a program: as a value and a throw, the branches would declare one Effect.
func TestDirectFormKeepsEffectUnion(t *testing.T) {
	for _, source := range []string{
		"export const f = (c: boolean) => c ? Effect.void : Effect.fail(\"x\")\n",
		"const t = Effect.succeed({ a: 1 })\nexport const f = (c: boolean) => c ? Effect.map(t, (x) => x.a) : Effect.succeed({ ...{ a: 1 }, k: true })\n",
	} {
		got, _ := fixedPipe(t, source)
		if strings.Contains(got, "throw") || strings.Contains(got, ": {") {
			t.Fatalf("--fix writes\n%s", got)
		}
	}
}
