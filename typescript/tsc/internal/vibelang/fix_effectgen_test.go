package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

const effectGenUsers = "export class Users extends Context.Service<Users, { readonly find: (id: string) => Effect.Effect<string> }>()(\"app/Users\") {}\n"

// D470: EK1002's quick fix writes Effect.gen and Effect.fn with effect and
// try, each yield* e becomes what runs e where it stands, and the result
// compiles.
func TestEffectGenQuickFixes(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"arrow body", effectGenUsers + `export const greet = (id: string) =>
  Effect.gen(function* () {
    const users = yield* Users
    // the user's name
    const name = yield* users.find(id)
    return ` + "`Hello, ${name}`" + `
  })
`, effectGenUsers + `export const greet = effect (id: string) => {
  const users = try Users
  // the user's name
  const name = try users.find(id)
  return ` + "`Hello, ${name}`" + `
}
`},
		{"arrow body on its line", "export const two = () => Effect.gen(function* () {\n  const n = yield* Effect.succeed(1)\n  return n + 1\n})\n",
			"export const two = effect () => {\n  const n = 1\n  return n + 1\n}\n"},
		{"function's only return", `export function count(n: number) {
  return Effect.gen(function* () {
    let total = 0
    for (let i = 0; i < n; i++) total += yield* Effect.succeed(i)
    return total
  })
}
`, `export effect function count(n: number) {
  let total = 0
  for (let i = 0; i < n; i++) total += i
  return total
}
`},
		{"function with a contract and no Effect", "export function two(): Effect.Effect<number> {\n  return Effect.gen(function* () {\n    return 2\n  })\n}\n", "export effect function two(): Effect.Effect<number> {\n  return 2\n}\n"},
		{"no Effect", "export const one = () => Effect.gen(function* () {\n  return 1\n})\n", "export const one = effect () => {\n  return 1\n}\n"},
		{"method with self this", `export class Box {
  constructor(readonly v: number) {}
  read() {
    return Effect.gen({ self: this }, function* () {
      const x = yield* Effect.succeed(this.v)
      return x
    })
  }
}
`, `export class Box {
  constructor(readonly v: number) {}
  effect read() {
    const x = this.v
    return x
  }
}
`},
		{"program argument", effectGenUsers + `export const UsersLive = Layer.effect(Users, Effect.gen(function* () {
  const prefix = yield* Effect.succeed("user-")
  return { find: (id: string) => Effect.succeed(prefix + id) }
}))
`, effectGenUsers + `export const UsersLive = Layer.effect(Users, effect {
  const prefix = "user-"
  return { find: (id: string) => Effect.succeed(prefix + id) }
})
`},
		{"a program value", "export const program = Effect.gen(function* () {\n  return yield* Effect.succeed(1)\n})\n", "export const program = effect {\n  return 1\n}\n"},
		{"a receiver", "export const f = () => Effect.gen(function* () {\n  return yield* Effect.succeed(1)\n}).pipe(Effect.asVoid)\n",
			"export const f = () => effect {\n  return 1\n} |> Effect.asVoid(%)\n"},
		{"a destructured parameter stays bound at the call", "export const f = ({ id }: { id: string }) => Effect.gen(function* () {\n  return yield* Effect.succeed(id)\n})\n",
			"export const f = ({ id }: { id: string }) => effect {\n  return id\n}\n"},
		{"a default parameter stays bound at the call", "export function f(id = \"a\") {\n  return Effect.gen(function* () {\n    return yield* Effect.succeed(id)\n  })\n}\n",
			"export function f(id = \"a\") {\n  return effect {\n    return id\n  }\n}\n"},
		{"a program held in a const", "export const f = () => Effect.gen(function* () {\n  const p = Effect.succeed(1)\n  return yield* p\n})\n",
			"export const f = effect () => {\n  const p = effect { return try Effect.succeed(1) }\n  return try p\n}\n"},
		{"a throw is a defect", "export const f = (n: number) => Effect.gen(function* () {\n  if (n < 0) throw new Error(\"negative\")\n  return yield* Effect.succeed(n)\n})\n",
			"export const f = effect (n: number) => {\n  if (n < 0) return try Effect.die(new Error(\"negative\"))\n  return n\n}\n"},
		{"Effect.fn", "export const f = Effect.fn(function* (n: number) {\n  return yield* Effect.succeed(n)\n})\n",
			"export const f = effect (n: number) => {\n  return n\n}\n"},
		{"Effect.fn with a return annotation", "export const f = Effect.fn(\"f\")(function* (n: number): Effect.fn.Return<number> {\n  return yield* Effect.succeed(n)\n})\n",
			"export const f = effect (n: number): Effect.Effect<number> => try Effect.withSpan(effect {\n  return n\n}, \"f\")\n"},
		{"Effect.fn reading import.meta", "export const f = Effect.fn(function* () {\n  return import.meta.url\n})\n",
			"export const f = effect () => {\n  return import.meta.url\n}\n"},
		{"Effect.fnUntraced where a plain member is declared", "import * as Context from \"effect/Context\"\nexport const Addresses = Context.Reference<Effect.Effect<ReadonlySet<string>>>(\"Addresses\", {\n  defaultValue: Effect.fnUntraced(function* () {\n    const resolved = yield* Effect.succeed([\"a\"])\n    return new Set(resolved)\n  }),\n})\n",
			"import * as Context from \"effect/Context\"\nexport const Addresses = Context.Reference<Effect.Effect<ReadonlySet<string>>>(\"Addresses\", {\n  defaultValue: () => effect {\n    const resolved = [\"a\"]\n    return new Set(resolved)\n  },\n})\n"},
		{"Effect.fnUntraced with a default", "export const f = Effect.fnUntraced(function* (n = 1) {\n  return yield* Effect.succeed(n)\n})\n",
			"export const f = effect (n = 1) => {\n  return n\n}\n"},
		{"Effect.fn with a name", "export const f = Effect.fn(\"f\")(function* (n: number) {\n  return yield* Effect.succeed(n)\n})\n",
			"export const f = effect (n: number) => try Effect.withSpan(effect {\n  return n\n}, \"f\")\n"},
		{"Effect.fn with span options", "export const f = Effect.fn(\"f\", { kind: \"client\" })(function* () {\n  return yield* Effect.succeed(1)\n})\n",
			"export const f = effect () => try Effect.withSpan(effect {\n  return 1\n}, \"f\", { kind: \"client\" })\n"},
		{"Effect.fn with stages", `export const f = Effect.fn("f")(
  function* (n: number) {
    return yield* Effect.succeed(n)
  },
  Effect.orElseSucceed(() => 0),
  Effect.asVoid,
)
`, `export const f = effect (n: number) => try Effect.withSpan(effect {
  return n
} |> Effect.orElseSucceed(%, () => 0) |> Effect.asVoid(%), "f")
`},
		{"Effect.fn stage that reads the arguments", `export const f = Effect.fn("f")(
  function* (n: number) {
    return yield* Effect.succeed(n)
  },
  (e, n) => Effect.map(e, (x) => x + n),
)
`, `export const f = effect (n: number) => try Effect.withSpan(effect {
  return n
} |> ((e, n) => Effect.map(e, (x) => x + n))(%, n), "f")
`},
		{"Effect.fn stage with unread arguments", "export const f = Effect.fn(\"f\")(function* (path: string, n: number) {\n  return yield* Effect.succeed(path.length + n)\n}, (effect, path) => Effect.option(effect))\n",
			"export const f = effect (path: string, n: number) => try Effect.withSpan(effect {\n  return path.length + n\n} |> ((effect, path) => Effect.option(effect))(%, path), \"f\")\n"},
		{"Effect.fn stage reading a rest parameter", "export const f = Effect.fn(function* (...xs: number[]) {\n  return yield* Effect.succeed(xs.length)\n}, (e, ...xs) => Effect.map(e, (n) => n + xs.length))\n",
			"export const f = effect (...xs: number[]) => try (effect {\n  return xs.length\n} |> ((e, ...xs) => Effect.map(e, (n) => n + xs.length))(%, ...xs))\n"},
		{"Effect.fn with a comment in its parameters", "export const f = Effect.fn(\"f\")(function* (\n  // The count.\n  n: number,\n) {\n  return yield* Effect.succeed(n)\n})\n",
			"export const f = effect (\n  // The count.\n  n: number,\n) => try Effect.withSpan(effect {\n  return n\n}, \"f\")\n"},
		{"Effect.fn with comments among its stages", `export const f = Effect.fn("f")(
  function* (n: number) {
    return yield* Effect.succeed(n)
  },
  // A missing count is zero.
  Effect.orElseSucceed(() => 0),
  (e) =>
    // Nothing reads the count.
    Effect.asVoid(e),
)
`, `export const f = effect (n: number) => try Effect.withSpan(effect {
  return n
}
  // A missing count is zero.
  |> Effect.orElseSucceed(%, () => 0) |> ((e) =>
    // Nothing reads the count.
    Effect.asVoid(e))(%), "f")
`},
		{"Effect.fn stage with its own pipe", "export const f = Effect.fn(\"f\")(function* (directory: string) {\n  return yield* Effect.succeed(directory.length)\n}, (effect, directory) => effect |> Effect.option(%))\n",
			"export const f = effect (directory: string) => try Effect.withSpan(effect {\n  return directory.length\n} |> ((effect, directory) => effect |> Effect.option(%))(%, directory), \"f\")\n"},
		{"Effect.fn reading this", "export class Box {\n  v = 1\n  read = Effect.fn(function* (this: Box) {\n    return yield* Effect.succeed(this.v)\n  })\n}\n",
			"export class Box {\n  v = 1\n  read = effect function (this: Box) {\n    return this.v\n  }\n}\n"},
		{"Effect.fn with an optional parameter", "export const f = Effect.fn(function* (n?: number) {\n  return yield* Effect.succeed(n)\n})\n",
			"export const f = effect (n?: number | undefined) => {\n  return n\n}\n"},
		{"Effect.fn on its own lines", "export const f = Effect.fn(\"f\")(\n  function* (n: number) {\n    return n\n  },\n)\n",
			"export const f = effect (n: number) => try Effect.withSpan(effect {\n  return n\n}, \"f\")\n"},
		{"Effect value", "export const run = (one: Effect.Effect<number>) => Effect.gen(function* () { return (yield* one) + 1 })\n",
			"export const run = effect (one: Effect.Effect<number>) => { return (try one) + 1 }\n"},
		{"a compound operand", "export const run = (a: Effect.Effect<number>, b: Effect.Effect<number>, c: boolean) => Effect.gen(function* () {\n  return yield* c ? a : b\n})\n",
			"export const run = effect (a: Effect.Effect<number>, b: Effect.Effect<number>, c: boolean) => {\n  return try (c ? a : b)\n}\n"},
		{"error instance", "export class Gone extends Data.TaggedError(\"Gone\")<{}> {}\nexport const check = (n: number) => Effect.gen(function* () {\n  if (n < 0) yield* new Gone()\n  if (n > 9) return yield* new Gone()\n  return yield* Effect.succeed(n)\n})\n",
			"export class Gone extends Data.TaggedError(\"Gone\")<{}> {}\nexport const check = effect (n: number) => {\n  if (n < 0) throw new Gone()\n  if (n > 9) throw new Gone()\n  return n\n}\n"},
		{"Effect.fail", "export class Gone extends Data.TaggedError(\"Gone\")<{}> {}\nexport const check = (n: number) => Effect.gen(function* () {\n  if (n < 0) yield* Effect.fail(new Gone())\n  return n\n})\n",
			"export class Gone extends Data.TaggedError(\"Gone\")<{}> {}\nexport const check = effect (n: number) => {\n  if (n < 0) throw new Gone()\n  return n\n}\n"},
		{"error instance in an expression", "export class Gone extends Data.TaggedError(\"Gone\")<{}> {}\nexport const check = (n: number) => Effect.gen(function* () {\n  const v = n < 0 ? 1 : yield* new Gone()\n  return v\n})\n",
			"export class Gone extends Data.TaggedError(\"Gone\")<{}> {}\nexport const check = effect (n: number) => {\n  const v = n < 0 ? 1 : try Effect.fail(new Gone())\n  return v\n}\n"},
		{"error a call gives", "export class Gone extends Data.TaggedError(\"Gone\")<{}> {}\nconst gone = (): Gone => new Gone()\nexport const check = (n: number) => Effect.gen(function* () {\n  if (n < 0) yield* gone()\n  if (n > 9) return yield* gone()\n  return yield* Effect.succeed(n)\n})\n",
			"export class Gone extends Data.TaggedError(\"Gone\")<{}> {}\nconst gone = (): Gone => new Gone()\nexport const check = effect (n: number) => {\n  if (n < 0) throw gone()\n  if (n > 9) throw gone()\n  return n\n}\n"},
		{"callback that returns its program", "const double = (n: number) => Effect.succeed(n * 2)\nexport const all = (xs: ReadonlyArray<number>) => Effect.gen(function* () {\n  return yield* Effect.forEach(xs, (x) => double(x))\n})\n",
			"const double = (n: number) => Effect.succeed(n * 2)\nexport const all = effect (xs: ReadonlyArray<number>) => {\n  return try Effect.forEach(xs, (x) => double(x))\n}\n"},
		{"template literal keeps its lines", "export const text = () =>\n    Effect.gen(function* () {\n      const n = yield* Effect.succeed(1)\n      return `a\n      ${n}`\n    })\n",
			"export const text = effect () => {\n  const n = 1\n  return `a\n      ${n}`\n}\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := effectGenQuickFix(t, test.source)
			if !ok {
				t.Fatalf("no quick fix for EK1002 in:\n%s\nnotes: %s", test.source, effectGenNotes(t, test.source))
			}
			if got != test.want {
				t.Fatalf("edited source differs:\ngot:\n%s\nwant:\n%s", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("the fixed source reports %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
			if again, ok := effectGenQuickFix(t, got); ok {
				t.Errorf("a second fix changes it again:\n%s", again)
			}
		})
	}
}

// try gives the value yield* gives, so a program a yield* gives stays a value,
// held until something runs it (Chapter 2's groupedHead).
func TestEffectGenProgramValueIsHeld(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"a binding", "export const f = (make: () => Effect.Effect<Effect.Effect<number>>) => Effect.gen(function* () {\n  const inner = yield* make()\n  return yield* inner\n})\n", "const inner = try make()\n  return try inner"},
		{"a returned program", "export const f = (make: () => Effect.Effect<Effect.Effect<number>>) => Effect.gen(function* () {\n  return yield* make()\n})\n", "return try make()"},
		{"a program that may be absent", "export const f = (make: () => Effect.Effect<Effect.Effect<number> | undefined>) => Effect.gen(function* () {\n  const inner = yield* make()\n  return inner === undefined ? 0 : yield* inner\n})\n", "const inner = try make()"},
		{"a dropped program", "export const f = (make: () => Effect.Effect<Effect.Effect<number>>) => Effect.gen(function* () {\n  yield* make()\n  return 1\n})\n", "void try make()"},
		{"a program run at once", "export const f = (make: () => Effect.Effect<Effect.Effect<number>>) => Effect.gen(function* () {\n  return yield* yield* make()\n})\n", "return try try make()"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := effectGenQuickFix(t, test.source)
			if !ok {
				t.Fatalf("no quick fix for:\n%s\nnotes: %s", test.source, effectGenNotes(t, test.source))
			}
			if !strings.Contains(got, test.want) {
				t.Fatalf("got:\n%s\nwant it to hold %q", got, test.want)
			}
		})
	}
}

// Where the rewrite would mean something else, EK1002 has no quick fix, and
// its note says why.
func TestEffectGenRefusals(t *testing.T) {
	for _, test := range []struct{ name, source, why string }{
		{"try", "export const f = (n: number) => Effect.gen(function* () {\n  try { return yield* Effect.succeed(n) } finally { n++ }\n})\n", "a try statement"},
		{"this without self", "export class Box {\n  v = 1\n  read() {\n    return Effect.gen(function* (this: any) {\n      return yield* Effect.succeed(1)\n    })\n  }\n}\n", "not a function* () { … } written in place"},
		{"arguments", "export function f(n: number) {\n  return Effect.gen(function* () {\n    return yield* Effect.succeed(arguments.length)\n  })\n}\n", "its own arguments"},
		{"a nested function*", "export const f = (xs: ReadonlyArray<number>) => Effect.gen(function* () {\n  return yield* Effect.forEach(xs, (x) => Effect.gen(function* () { return yield* Effect.succeed(x) }))\n})\n", "another function*"},
		{"a comment outside the body", "export const f = () => Effect.gen(/* why */ function* () {\n  return yield* Effect.succeed(1)\n})\n", "a comment stands between"},
		{"a comment after Effect.fn's last stage", "export const f = Effect.fn(function* (n: number) {\n  return yield* Effect.succeed(n)\n}, Effect.asVoid /* why */)\n", "a comment stands between"},
		{"a comment before Effect.fn's generator", "export const f = Effect.fn(/* why */ function* (n: number) {\n  return yield* Effect.succeed(n)\n})\n", "a comment stands between"},
		{"another return type", "type G = Generator<never, number>\nexport const f = Effect.fn(function* (n: number): G {\n  return n\n})\n", "a return type other than Effect.fn.Return"},
		{"a return annotation before stages", "export const f = Effect.fn(function* (n: number): Effect.fn.Return<number> {\n  return n\n}, Effect.map((x) => x + 1))\n", "names the Effect before its stages"},
		{"new.target", "export function F(this: unknown) {\n  return Effect.gen(function* () {\n    return new.target === undefined\n  })\n}\n", "new.target"},
		{"an Effect.fn stage that reads a defaulted argument", "export const f = Effect.fn(function* (n: number = 1) {\n  return yield* Effect.succeed(n)\n}, (e, n) => Effect.map(e, (x) => x + (n ?? 0)))\n", "does not hold its argument"},
		{"an Effect.fn stage that reads a destructured argument", "export const f = Effect.fn(function* ({ n }: { n: number }) {\n  return yield* Effect.succeed(n)\n}, (e, o) => Effect.map(e, (x) => x + o.n))\n", "does not hold its argument"},
		{"an Effect.fn stage that reads a name a parameter hides", "const n = 1\nexport const f = Effect.fn(function* (n: number) {\n  return yield* Effect.succeed(n)\n}, Effect.map((x) => x + n))\n", "would hide"},
		{"an Effect.fn stage that reads an argument no parameter names", "export const f = Effect.fn(function* (n: number) {\n  return yield* Effect.succeed(n)\n}, (e: Effect.Effect<number>, n: number, m?: number) => Effect.map(e, (x) => x + n + (m ?? 0)))\n", "more arguments than"},
		{"an Effect.fn stage that renames an argument", "export const f = Effect.fn(\"f\")(function* (directory: string) {\n  return yield* Effect.succeed(directory.length)\n}, (effect, _directory) => Effect.option(effect))\n", "Effect.fn's declaration takes"},
		{"an Effect.fn stage that is a spread", "const stages = [Effect.asVoid] as const\nexport const f = Effect.fn(function* (n: number) {\n  return yield* Effect.succeed(n)\n}, ...stages)\n", "a stage is a spread"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got, ok := effectGenQuickFix(t, test.source); ok {
				t.Fatalf("unexpected quick fix:\n%s", got)
			}
			notes := effectGenNotes(t, test.source)
			if !strings.Contains(notes, "No quick fix") || !strings.Contains(notes, test.why) {
				t.Fatalf("EK1002's notes %q do not say %q", notes, test.why)
			}
		})
	}
}

// A member named arguments, or named as the generator is, reads no binding of
// the generator: only arguments and the generator's name themselves do.
func TestEffectGenMemberNamesAreNotBindings(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"a parameter's member", "export const f = Effect.fnUntraced(function* (input: { arguments: string[] }) {\n  return yield* Effect.succeed(input.arguments)\n})\n", "input.arguments"},
		{"an optional member", "export const f = Effect.fnUntraced(function* (input?: { arguments: string[] }) {\n  return yield* Effect.succeed(input?.arguments)\n})\n", "input?.arguments"},
		{"a property of a literal", "export const f = Effect.fnUntraced(function* (n: number) {\n  return yield* Effect.succeed({ arguments: n })\n})\n", "{ arguments: n }"},
		{"a member named as the generator", "export const f = (o: { load: number }) => Effect.gen(function* load() {\n  return yield* Effect.succeed(o.load)\n})\n", "o.load"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := effectGenQuickFix(t, test.source)
			if !ok {
				t.Fatalf("no quick fix for:\n%s\nnotes: %s", test.source, effectGenNotes(t, test.source))
			}
			if !strings.Contains(got, test.want) {
				t.Fatalf("the fix lost %q:\n%s", test.want, got)
			}
		})
	}
	// Shorthand and a computed key read the binding, so these stay refused.
	for name, source := range map[string]string{
		"shorthand":    "export function f() {\n  return Effect.gen(function* () {\n    return yield* Effect.succeed({ arguments })\n  })\n}\n",
		"computed key": "export function f() {\n  return Effect.gen(function* () {\n    return yield* Effect.succeed({ [arguments.length]: 1 })\n  })\n}\n",
		"element":      "export function f(o: Record<number, number>) {\n  return Effect.gen(function* () {\n    return yield* Effect.succeed(o[arguments.length])\n  })\n}\n",
	} {
		t.Run(name, func(t *testing.T) {
			if got, ok := effectGenQuickFix(t, source); ok {
				t.Fatalf("unexpected quick fix:\n%s", got)
			}
			if notes := effectGenNotes(t, source); !strings.Contains(notes, "its own arguments") {
				t.Fatalf("EK1002's notes %q do not name the arguments", notes)
			}
		})
	}
}

// Effect.fn calls each stage with the program and the arguments as the
// caller wrote them. The effect function that replaces it passes a stage its
// parameters, so the fix exists only where each parameter the stage reads
// holds its argument, a name with no default, where the stage reads no more
// arguments than the generator names, where the stage names them as the
// generator does (Effect.fn's declaration takes the stage's names), and where
// no stage reads an outer name that a generator parameter would hide. The
// fixed source compiles and keeps the stage's text.
func FuzzEffectFnStageArguments(f *testing.F) {
	parameters := []struct {
		text  string
		holds bool // the parameter holds the argument the caller wrote
	}{
		{"n: number, m?: number", true},
		{"n?: number, m?: number", true},
		{"n: number = 1, m?: number", false},
		{"{ n }: { n: number }, m?: number", false},
	}
	for p := range len(parameters) {
		for arity := range uint8(3) {
			for _, flags := range []uint8{0, 1, 2} {
				f.Add(uint8(p), arity, flags)
			}
		}
	}
	f.Fuzz(func(t *testing.T, p, arity, flags uint8) {
		parameter := parameters[int(p)%len(parameters)]
		shadow, renamed := flags%3 == 1, flags%3 == 2
		// The stage reads the program alone, or every argument, or one more
		// than the generator names.
		reads := []int{1, 3, 4}[int(arity)%3]
		names := []string{"e", "n", "m", "c"}[:reads]
		if renamed {
			for i := 1; i < len(names); i++ {
				names[i] = "_" + names[i]
			}
		}
		outer := "o"
		if shadow {
			outer = "n" // an outer name that the generator's n would hide
		}
		read := outer
		if shadow && reads > 1 && !renamed {
			read = "k" // the stage's own n would bind it: read another outer name
			outer = "k"
		}
		stage := "(" + strings.Join(names, ", ") + ") => Effect.map(e, (x) => x + " + read + ")"
		source := "const " + outer + " = 1\nexport const f = Effect.fn(\"f\")(function* (" + parameter.text + ") {\n  return yield* Effect.succeed(1)\n}, " + stage + ")\n"
		hidden := read == "n"
		want := !hidden && (reads == 1 || parameter.holds && reads == 3 && !renamed)
		got, ok := effectGenQuickFix(t, source)
		if ok != want {
			t.Fatalf("quick fix %v, want %v, for:\n%s\ngot:\n%s\nnotes: %s", ok, want, source, got, effectGenNotes(t, source))
		}
		if !ok {
			if notes := effectGenNotes(t, source); !strings.Contains(notes, "No quick fix") {
				t.Fatalf("EK1002's notes %q give no reason", notes)
			}
			return
		}
		if !strings.Contains(got, stage) {
			t.Fatalf("the fix lost the stage %q:\n%s", stage, got)
		}
		program, file, _, _ := editorProgram(t, got)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("the fixed source reports %s%d: %s\n%s", d.Source(), d.Code(), d.String(), got)
			}
		}
	})
}

// A generator's reads of arguments and of its name, in every position a name
// can stand: a position that names a member gets the quick fix and keeps its
// text, and one that reads the binding keeps EK1002 with the reason.
func FuzzEffectGenBindingReads(f *testing.F) {
	memberForms := []string{"o.%s", "o?.%s", "o.%s.length", "(o).%s", "{ %s: 1 }", "{ %s() { return 1 } }", "o[\"%s\"]"}
	readForms := []string{"%s", "{ %s }", "{ [%s.length]: 1 }", "o[%s.length]", "[%s]", "%s.length", "(%s)"}
	for form := range len(memberForms) + len(readForms) {
		f.Add(uint8(form), uint8(0))
		f.Add(uint8(form), uint8(1))
	}
	f.Fuzz(func(t *testing.T, form, name uint8) {
		i := int(form) % (len(memberForms) + len(readForms))
		isMember := i < len(memberForms)
		text, why, head := "arguments", "its own arguments", "function* ()"
		if name%2 == 1 {
			text, why, head = "self", "by its name", "function* self()"
		}
		expression := ""
		if isMember {
			expression = fmt.Sprintf(memberForms[i], text)
		} else {
			expression = fmt.Sprintf(readForms[i-len(memberForms)], text)
		}
		source := "export function f(o: any) {\n  return Effect.gen(" + head + " {\n    return yield* Effect.succeed(" + expression + ")\n  })\n}\n"
		got, ok := effectGenQuickFix(t, source)
		if isMember {
			if !ok {
				t.Fatalf("no quick fix for:\n%s\nnotes: %s", source, effectGenNotes(t, source))
			}
			if !strings.Contains(got, expression) {
				t.Fatalf("the fix lost %q:\n%s", expression, got)
			}
			return
		}
		if ok {
			t.Fatalf("a read of %s got a quick fix:\n%s\nfrom:\n%s", text, got, source)
		}
		if notes := effectGenNotes(t, source); !strings.Contains(notes, why) {
			t.Fatalf("EK1002's notes %q do not say %q for:\n%s", notes, why, source)
		}
	})
}

// A yield* whose success is itself a program holds it: try runs one layer, and
// the value stays a program until something runs it (explicit effects).
func TestEffectGenKeepsAProgramAsAValue(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"held, then run", "export const f = (make: () => Effect.Effect<Effect.Effect<number>>) => Effect.gen(function* () {\n  const inner = yield* make()\n  return yield* inner\n})\n", "const inner = try make()\n  return try inner"},
		{"returned", "export const f = (make: () => Effect.Effect<Effect.Effect<number>>) => Effect.gen(function* () {\n  return yield* make()\n})\n", "return try make()"},
		{"a helper's finalizer", "export const f = (listen: () => Effect.Effect<Effect.Effect<void>>) => Effect.gen(function* () {\n  const unsubscribe = yield* listen()\n  yield* Effect.addFinalizer(() => unsubscribe)\n})\n", "try Effect.addFinalizer(() => unsubscribe)"},
		{"both layers", "export const f = (make: () => Effect.Effect<Effect.Effect<number>>) => Effect.gen(function* () {\n  return yield* yield* make()\n})\n", "try"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := effectGenQuickFix(t, test.source)
			if !ok {
				t.Fatalf("no quick fix for:\n%s\nnotes: %s", test.source, effectGenNotes(t, test.source))
			}
			if !strings.Contains(got, test.want) {
				t.Fatalf("want %q in:\n%s", test.want, got)
			}
		})
	}
}

// An Effect.fn with a pipeline argument is EK1002 too, though no overload
// accepts the call while function* declares a producer: its generator is not
// a producer, so EK2128's fix never drops its return value (drive-t3code).
func TestEffectGenLeavesEffectFnPipeline(t *testing.T) {
	source := `export const load = Effect.fn("load")(
  function* (n: number) {
    yield* Effect.void
    return n ? Option.some(n) : Option.none<number>()
  },
  Effect.orElseSucceed(() => Option.none<number>()),
)
`
	program, file, _, _ := editorProgram(t, source)
	var codes []int32
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		codes = append(codes, d.Code())
	}
	if !slices.Contains(codes, EK1002.Code) || slices.Contains(codes, EK2128.Code) {
		t.Fatalf("codes %v; want EK1002 and no EK2128", codes)
	}
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if fixed := result.Files[file.FileName()]; fixed == nil || fixed.Counts[EK2128.Code] != 0 || !strings.Contains(fixed.Text, "return n ? Option.some(n)") {
		t.Fatalf("--fix wrote\n%s\ncounts %v", fixed.Text, fixed.Counts)
	}
}

// vibelang --fix fixes an inner Effect.gen first and its outer one in the
// next round, though a fix of another Effect.gen was refused before it: each
// call is its own fix (fixKey).
func TestEffectGenFixRounds(t *testing.T) {
	source := `export const outer = (xs: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    return yield* Effect.forEach(xs, (x) =>
      Effect.gen(function* () {
        return yield* Effect.succeed(x + 1)
      }))
  })
export const refused = () =>
  Effect.gen(function* () {
    const n = yield* Effect.succeed(1)
    const s: string = n
    return s
  })
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	result := fixCase(t, dir)
	fixed := result.Files[file.FileName()]
	if fixed == nil {
		t.Fatalf("nothing fixed; refused %+v", result.Refused)
	}
	want := `export const outer = effect (xs: ReadonlyArray<number>) => {
  return try Effect.forEach(xs, effect (x) => {
    return x + 1
  })
}
`
	if !strings.HasPrefix(fixed.Text, want) {
		t.Fatalf("--fix writes\n%s\nwant it to start with\n%s", fixed.Text, want)
	}
	if fixed.Counts[EK1002.Code] != 2 || len(result.Refused) != 1 || result.Refused[0].Code != EK1002.Code {
		t.Fatalf("counts %v, refused %+v; want two EK1002 fixes and one refused", fixed.Counts, result.Refused)
	}
	if original, _ := os.ReadFile(file.FileName().AsString()); string(original) != source {
		t.Fatal("FixProject wrote the file")
	}
}

// effectGenDiagnostic returns source's first EK1002, which is an error.
func effectGenDiagnostic(t *testing.T, source string) (*ast.Diagnostic, func() (string, bool)) {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	var diagnostic *ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK1002.Code {
			diagnostic = d
			break
		}
	}
	if diagnostic == nil {
		return nil, func() (string, bool) { return "", false }
	}
	if diagnostic.Category() != diagnostics.CategoryError {
		t.Fatalf("EK1002 is %v, want an error", diagnostic.Category())
	}
	return diagnostic, func() (string, bool) {
		d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		if response.CommandOrCodeActionArray != nil {
			for _, action := range *response.CommandOrCodeActionArray {
				if action.CodeAction != nil && (strings.HasPrefix(action.CodeAction.Title, "Write an effect") || strings.HasPrefix(action.CodeAction.Title, "Write a function")) && action.CodeAction.Edit != nil && action.CodeAction.Edit.Changes != nil {
					changes := *action.CodeAction.Edit.Changes
					return applyEditorEdits(t, file, converters, changes[lsconv.FileNameToDocumentURI(file.FileName())]), true
				}
			}
		}
		return "", false
	}
}

// effectGenQuickFix returns source with its first EK1002's quick fix applied,
// and whether it has one.
func effectGenQuickFix(t *testing.T, source string) (string, bool) {
	t.Helper()
	_, fix := effectGenDiagnostic(t, source)
	return fix()
}

// effectGenNotes returns the notes under source's first EK1002.
func effectGenNotes(t *testing.T, source string) string {
	t.Helper()
	d, _ := effectGenDiagnostic(t, source)
	if d == nil {
		t.Fatalf("missing EK1002 in:\n%s", source)
	}
	notes := ""
	for _, chained := range d.MessageChain() {
		notes += chained.String() + "\n"
	}
	return notes
}

// Each migrate-* case is Effect TypeScript that a migration renames to .vibe:
// each of its .ts files whose name the case's -fixed twin holds as a .vibe
// file. Its twin is what vibelang --fix then writes, and fixing the twin
// changes nothing. The smoke harness runs both and checks that they return
// the same result. The case's expected/ declarations are the TypeScript's;
// applying the migration rules' own fixes, before --fix's other rules and its
// prelude rewrites, emits them unchanged (Chapter 28).
func TestMigrationCasesFix(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fixtures, err := filepath.Glob(filepath.Join(root, "typescript/vibelang/cases/migrate-*"))
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, fixture := range fixtures {
		if strings.HasSuffix(fixture, "-fixed") {
			continue
		}
		twin := fixture + "-fixed"
		renamed, _ := filepath.Glob(filepath.Join(twin, "*.vibe"))
		if len(renamed) == 0 {
			t.Errorf("%s has no fixed twin with .vibe files", filepath.Base(fixture))
			continue
		}
		count++
		t.Run(filepath.Base(fixture), func(t *testing.T) {
			migrated := func() string {
				dir := copyCompilerFixture(t, fixture, root)
				for _, name := range renamed {
					base := strings.TrimSuffix(filepath.Base(name), ".vibe")
					if err := os.Rename(filepath.Join(dir, base+".ts"), filepath.Join(dir, base+".vibe")); err != nil {
						t.Fatal(err)
					}
				}
				return dir
			}
			result := fixCase(t, migrated())
			for _, name := range renamed {
				want, err := os.ReadFile(name)
				if err != nil {
					t.Fatal(err)
				}
				got := ""
				for file, fixed := range result.Files {
					if filepath.Base(file.AsString()) == filepath.Base(name) {
						got = fixed.Text
					}
				}
				if got != string(want) {
					t.Errorf("%s: --fix writes\n%s\nwant\n%s", filepath.Base(name), got, want)
				}
			}
			if len(result.Refused) != 0 {
				t.Errorf("refused: %v", result.Refused)
			}
			if again := fixCase(t, copyCompilerFixture(t, twin, root)); len(again.Files) != 0 {
				t.Errorf("fixing the twin again changes %v", again.Order)
			}
			goldens, _ := filepath.Glob(filepath.Join(fixture, "expected", "*.d.ts"))
			if len(goldens) == 0 {
				return
			}
			declarations := migrationRuleDeclarations(t, migrated(), []int32{EK1002.Code, EK4841.Code, EK4842.Code})
			for _, golden := range goldens {
				want, err := os.ReadFile(golden)
				if err != nil {
					t.Fatal(err)
				}
				if got := declarations[filepath.Base(golden)]; got != string(want) {
					t.Errorf("after the migration rules, %s is\n%s\nwant the TypeScript's\n%s", filepath.Base(golden), got, want)
				}
			}
		})
	}
	if count == 0 {
		t.Fatal("no migrate cases")
	}
}

// migrationRuleDeclarations applies, in rounds as vibelang --fix does, only
// the fixes of codes to the project in dir, and returns the declaration files
// it then emits, by base name.
func migrationRuleDeclarations(t *testing.T, dir string, codes []int32) map[string]string {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	texts := map[tspath.RootedFilePath]string{}
	parsed := &fixParsedFiles{}
	program := fixProgram(fs, bundled.LibPath(), config, parsed, texts)
	for range 32 { // each round applies a fix; a construct draws no fix of its own kind again
		changed := false
		for _, file := range fixableFiles(program) {
			p := fileFixes(t.Context(), program, file, map[string]bool{}, tsFormFixCodes)
			p.fixes = slices.DeleteFunc(p.fixes, func(f fileFix) bool { return !slices.Contains(codes, f.code) })
			if len(p.fixes) > 0 {
				texts[file.FileName()] = p.text()
				changed = true
			}
		}
		if !changed {
			break
		}
		program = fixProgram(fs, bundled.LibPath(), config, parsed, texts)
	}
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("after the migration rules: %s", d.String())
		}
	}
	out := map[string]string{}
	var mutex sync.Mutex // a program's files emit in parallel
	program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), ".d.ts") {
			mutex.Lock()
			defer mutex.Unlock()
			out[filepath.Base(name.AsString())] = text
		}
		return nil
	}})
	return out
}

// D24: a VibeLang function returning an Effect subtype constructs data.
// Writing try for yield* still runs that result, including in a statement.
func TestEffectGenRunsStructuredVibeResults(t *testing.T) {
	const prefix = "interface Query extends Effect.Effect<number> { readonly sql: string }\nfunction query(): Query { return null as any }\n"
	source := prefix + "export const run = () => Effect.gen(function* () {\n  const n = yield* query()\n  yield* query()\n  return n\n})\n"
	want := prefix + "export const run = effect () => {\n  const n = try query()\n  try query()\n  return n\n}\n"
	got, ok := effectGenQuickFix(t, source)
	if !ok {
		t.Fatalf("no quick fix: %s", effectGenNotes(t, source))
	}
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
	program, file, _, _ := editorProgram(t, got)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("fixed program: %s", d.String())
		}
	}
}
