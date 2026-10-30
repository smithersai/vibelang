package vibelang

import (
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

// D470: EK1002's quick fix writes an Effect.gen program in direct style, so a
// yield* e becomes what runs e where it stands, and the result compiles.
func TestEffectGenQuickFixes(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"arrow body", effectGenUsers + `export const greet = (id: string) =>
  Effect.gen(function* () {
    const users = yield* Users
    // the user's name
    const name = yield* users.find(id)
    return ` + "`Hello, ${name}`" + `
  })
`, effectGenUsers + `export const greet = (id: string) => {
  const users = Users()
  // the user's name
  const name = users.find(id)
  return ` + "`Hello, ${name}`" + `
}
`},
		{"arrow body on its line", "export const two = () => Effect.gen(function* () {\n  const n = yield* Effect.succeed(1)\n  return n + 1\n})\n",
			"export const two = () => {\n  const n = Effect.succeed(1)\n  return n + 1\n}\n"},
		{"function's only return", `export function count(n: number) {
  return Effect.gen(function* () {
    let total = 0
    for (let i = 0; i < n; i++) total += yield* Effect.succeed(i)
    return total
  })
}
`, `export function count(n: number) {
  let total = 0
  for (let i = 0; i < n; i++) total += Effect.succeed(i)
  return total
}
`},
		{"function with a contract and no Effect", "export function two(): Effect.Effect<number> {\n  return Effect.gen(function* () {\n    return 2\n  })\n}\n", "export function two(): Effect.Effect<number> {\n  return 2\n}\n"},
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
  read() {
    const x = Effect.succeed(this.v)
    return x
  }
}
`},
		{"program argument", effectGenUsers + `export const UsersLive = Layer.effect(Users, Effect.gen(function* () {
  const prefix = yield* Effect.succeed("user-")
  return { find: (id: string) => Effect.succeed(prefix + id) }
}))
`, effectGenUsers + `export const UsersLive = Layer.effect(Users, () => {
  const prefix = Effect.succeed("user-")
  return { find: (id: string) => Effect.succeed(prefix + id) }
})
`},
		{"Effect value", "export const run = (one: Effect.Effect<number>) => Effect.gen(function* () { return (yield* one) + 1 })\n",
			"export const run = (one: Effect.Effect<number>) => { return (one()) + 1 }\n"},
		{"error instance", "export class Gone extends Data.TaggedError(\"Gone\")<{}> {}\nexport const check = (n: number) => Effect.gen(function* () {\n  if (n < 0) yield* new Gone()\n  if (n > 9) return yield* new Gone()\n  return yield* Effect.succeed(n)\n})\n",
			"export class Gone extends Data.TaggedError(\"Gone\")<{}> {}\nexport const check = (n: number) => {\n  if (n < 0) throw new Gone()\n  if (n > 9) throw new Gone()\n  return Effect.succeed(n)\n}\n"},
		{"callback that returns its program", "const double = (n: number) => Effect.succeed(n * 2)\nexport const all = (xs: ReadonlyArray<number>) => Effect.gen(function* () {\n  return yield* Effect.forEach(xs, (x) => double(x))\n})\n",
			"const double = (n: number) => Effect.succeed(n * 2)\nexport const all = (xs: ReadonlyArray<number>) => {\n  return Effect.forEach(xs, (x) => double(x))\n}\n"},
		{"template literal keeps its lines", "export const text = () =>\n    Effect.gen(function* () {\n      const n = yield* Effect.succeed(1)\n      return `a\n      ${n}`\n    })\n",
			"export const text = () => {\n  const n = Effect.succeed(1)\n  return `a\n      ${n}`\n}\n"},
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

// Where the direct style would mean something else, EK1002 has no quick fix,
// and its note says why.
func TestEffectGenRefusals(t *testing.T) {
	for _, test := range []struct{ name, source, why string }{
		{"a program built and not yielded", "export const f = () => Effect.gen(function* () {\n  const p = Effect.succeed(1)\n  return yield* p\n})\n", "Effect.succeed(1) builds a program that no yield* runs"},
		{"a callback that drops a program", "export const f = () => Effect.gen(function* () {\n  return yield* Effect.forEach([1], (x) => { Effect.log(\"x\"); return Effect.succeed(x) })\n})\n", "in a callback, Effect.log(\"x\") builds a program"},
		{"throw", "export const f = (n: number) => Effect.gen(function* () {\n  if (n < 0) throw new Error(\"negative\")\n  return yield* Effect.succeed(n)\n})\n", "a throw in a generator"},
		{"try", "export const f = (n: number) => Effect.gen(function* () {\n  try { return yield* Effect.succeed(n) } finally { n++ }\n})\n", "a try statement"},
		{"this without self", "export class Box {\n  v = 1\n  read() {\n    return Effect.gen(function* (this: any) {\n      return yield* Effect.succeed(1)\n    })\n  }\n}\n", "not a function* () { … } written in place"},
		{"arguments", "export function f(n: number) {\n  return Effect.gen(function* () {\n    return yield* Effect.succeed(arguments.length)\n  })\n}\n", "its own arguments"},
		{"a destructured parameter", "export const f = ({ id }: { id: string }) => Effect.gen(function* () {\n  return yield* Effect.succeed(id)\n})\n", "a parameter has a default or a pattern"},
		{"a default parameter", "export const f = (id = \"a\") => Effect.gen(function* () {\n  return yield* Effect.succeed(id)\n})\n", "a parameter has a default or a pattern"},
		{"a program value", "export const program = Effect.gen(function* () {\n  return yield* Effect.succeed(1)\n})\n", "Effect.gen here is a program value"},
		{"a receiver", "export const f = () => Effect.gen(function* () {\n  return yield* Effect.succeed(1)\n}).pipe(Effect.map((n) => n + 1))\n", "Effect.gen here is a program value"},
		{"no Effect", "export const one = () => Effect.gen(function* () {\n  return 1\n})\n", "the body runs no Effect"},
		{"no Effect in a function declaration", "export function one() {\n  return Effect.gen(function* () {\n    return 1\n  })\n}\n", "the body runs no Effect"},
		{"a plain helper is not a program", "function required<T>(x: T | undefined): T { return x as T }\nexport const f = (n?: number) => Effect.gen(function* () {\n  const p = Effect.succeed(required(n))\n  return yield* p\n})\n", "Effect.succeed(required(n)) builds a program"},
		{"a nested function*", "export const f = (xs: ReadonlyArray<number>) => Effect.gen(function* () {\n  return yield* Effect.forEach(xs, (x) => Effect.gen(function* () { return yield* Effect.succeed(x) }))\n})\n", "another function*"},
		{"a program as the value", "export const f = (make: () => Effect.Effect<Effect.Effect<number>>) => Effect.gen(function* () {\n  const inner = yield* make()\n  return yield* inner\n})\n", "gives a program as its value"},
		{"a var named as a parameter", "export const f = (x: number) => Effect.gen(function* () {\n  var x = 2\n  return yield* Effect.succeed(x)\n})\n", "the generator declares x"},
		{"a comment outside the body", "export const f = () => Effect.gen(/* why */ function* () {\n  return yield* Effect.succeed(1)\n})\n", "a comment stands between"},
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

// Effect.fn adds a span and stack frames that a direct-style body does not,
// so its EK1002 has no quick fix.
func TestEffectGenLeavesEffectFn(t *testing.T) {
	source := "export const f = Effect.fn(\"f\")(function* (n: number) {\n  return yield* Effect.succeed(n)\n})\n"
	if got, ok := effectGenQuickFix(t, source); ok {
		t.Fatalf("unexpected quick fix:\n%s", got)
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
	want := `export const outer = (xs: ReadonlyArray<number>) => {
  return Effect.forEach(xs, (x) => {
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
				if action.CodeAction != nil && action.CodeAction.Title == "Write the body in direct style" && action.CodeAction.Edit != nil && action.CodeAction.Edit.Changes != nil {
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
