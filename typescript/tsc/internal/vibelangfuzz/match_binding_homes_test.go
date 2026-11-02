package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// FuzzMatchBindingHomes holds Chapter 4, Typing, across the homes a match
// expression stands in and against its TypeScript counterpart; migfix-smithers'
// FuzzMatchBindingTypes varies the pattern shapes under the same options.
// Chapter 4 types each pattern under the project compiler options, and
// "A `let` binding has the
// type TypeScript gives the value it is bound to in the counterpart." Every
// counterpart below reads a property, a tuple element or the narrowed subject,
// so compiler options that widen index accesses (`noUncheckedIndexedAccess`)
// or optional properties (`exactOptionalPropertyTypes`) change nothing: the
// binding keeps the type the table gives it. The input picks a pattern, the
// home of the match and the options; the generated program returns the
// binding as the table's type, so a widened binding (`A | undefined`) is
// TS2322. The counterpart compiles first as a control (D266: ordinary
// TypeScript keeps TypeScript's diagnostics under these options). smithers'
// agent/fs package sets `noUncheckedIndexedAccess` and its `when
// Exit.Success(let value)` bound `A | undefined` (inbox migrate-smithers
// 2026-11-01; decided detail 79).
func FuzzMatchBindingHomes(f *testing.F) {
	startShortBudget(f)
	bindingHomeChapters(f)
	w := NewWorkspace(f)
	for _, seed := range bindingHomeSeeds() {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckMatchBindingHomes(t, w, parseBindingHome(data))
	})
}

// TestMatchBindingHomesQuoted fails when Chapter 4 rewords a sentence the
// oracle quotes (RULES.md 9).
func TestMatchBindingHomesQuoted(t *testing.T) { bindingHomeChapters(t) }

var bindingHomeQuotes = []string{
	"Patterns type as the TypeScript counterpart this chapter shows for them, under the project's compiler options; the table below illustrates `tsc --strict`",
	"A `let` binding has the type TypeScript gives the value it is bound to in the counterpart.",
	"| fixed `Option.Some(let v)` | `Option.isOption(s) && Option.isSome(s)` | `v`: `A` for `Option<A>`; `unknown` for an `unknown` subject |",
	"| fixed `Exit.Failure(let c)`, `Result.Success(let v)` | the module guards ([Retained fixed patterns](#retained-fixed-patterns)) | `c`: `Cause.Cause<E>`; `v`: `A` |",
	"| `Exit.Success` | `Exit.isExit(s) && Exit.isSuccess(s)` | `[s.value]` |",
	"| `Result.Failure` | `Result.isResult(s) && Result.isFailure(s)` | `[s.failure]` |",
	"| array `[let a, let b]` | members that are iterable | the element type of the subject",
	"| `error` / `schema error` class `NotFound`, `NotFound(let e)` |",
}

func bindingHomeChapters(tb testing.TB) {
	tb.Helper()
	text := SpecText("004-match.md")
	for _, quote := range bindingHomeQuotes {
		if !strings.Contains(text, quote) {
			tb.Fatalf("004-match.md no longer says %q", quote)
		}
	}
}

// A bindingHomePattern is one row of the Typing table: the subject type the
// pattern tests, the type the table gives its binding, the arm, and the
// counterpart expression the arm stands for.
type bindingHomePattern struct {
	name    string
	subject string // in A and E
	result  string // the binding type the table gives
	arm     string // `when <pattern>: <binding expression>;`
	ts      string // the counterpart over s and fallback
	decls   string // declarations the .vibe program needs
	tsDecls string // the same declarations in the counterpart
}

var bindingHomePatterns = []bindingHomePattern{
	{name: "exit-success", subject: "Exit.Exit<A, E>", result: "A",
		arm: "when Exit.Success(let value): value;", ts: "Exit.isSuccess(s) ? s.value : fallback"},
	{name: "exit-failure", subject: "Exit.Exit<A, E>", result: "Cause.Cause<E>",
		arm: "when Exit.Failure(let cause): cause;", ts: "Exit.isFailure(s) ? s.cause : fallback"},
	{name: "option-some", subject: "Option.Option<A>", result: "A",
		arm: "when Option.Some(let value): value;", ts: "Option.isSome(s) ? s.value : fallback"},
	{name: "result-success", subject: "Result.Result<A, E>", result: "A",
		arm: "when Result.Success(let value): value;", ts: "Result.isSuccess(s) ? s.success : fallback"},
	{name: "result-failure", subject: "Result.Result<A, E>", result: "E",
		arm: "when Result.Failure(let failure): failure;", ts: "Result.isFailure(s) ? s.failure : fallback"},
	{name: "error-class", subject: "NotFound | Gone", result: "NotFound",
		arm: "when NotFound(let e): e;", ts: "s._tag === \"NotFound\" ? s : fallback",
		decls:   "export error NotFound { id: string }\nexport error Gone { id: string }\n\n",
		tsDecls: "export class NotFound extends Data.TaggedError(\"NotFound\")<{ readonly id: string }> {}\nexport class Gone extends Data.TaggedError(\"Gone\")<{ readonly id: string }> {}\n\n"},
	{name: "object", subject: "{ readonly _tag: \"Sent\"; readonly tracking: A } | { readonly _tag: \"Lost\" }", result: "A",
		arm: "when { _tag: \"Sent\", let tracking }: tracking;", ts: "s._tag === \"Sent\" ? s.tracking : fallback"},
	{name: "tuple", subject: "readonly [A, E]", result: "A",
		arm: "when [let first, let second]: first;", ts: "s[0]"},
	{name: "nested", subject: "Option.Option<Exit.Exit<A, E>>", result: "A",
		arm: "when Option.Some(Exit.Success(let value)): value;", ts: "Option.isSome(s) && Exit.isSuccess(s.value) ? s.value.value : fallback"},
	{name: "cause-error", subject: "Cause.TimeoutError | Cause.NoSuchElementError", result: "\"TimeoutError\"",
		arm: "when Cause.TimeoutError(let timeout): timeout._tag;", ts: "Cause.isTimeoutError(s) ? s._tag : fallback"},
}

// bindingHomeHomes are where the match expression stands.
var bindingHomeHomes = []string{"function", "arrow", "method"}

// bindingHomeOptions are the compiler option sets, each on top of strict.
var bindingHomeOptions = []string{"strict", "noUncheckedIndexedAccess", "exactOptionalPropertyTypes", "both"}

// bindingHomeLiterals are migrated sources kept byte for byte, with the
// options their package sets.
var bindingHomeLiterals = map[string]struct{ source, options string }{
	// smithers packages/smithers/agent/fs, SchemaBridge.vibe line 70 as
	// drive-smithers minimized it (inbox migrate-smithers 2026-11-01, repro
	// exit-success-binding/a.vibe).
	"smithers-exit-success-binding": {`export effect function recover<A>(program: Effect<A, unknown, unknown>, failure: () => Effect<string>): Effect<A, string, infer R> {
  return match (try exit(program as Effect<A, unknown>)) {
    when Exit.Success(let value): value;
    default: throw try failure();
  }
}
`, "noUncheckedIndexedAccess"},
}

type bindingHomeInput struct {
	pattern       bindingHomePattern
	home, options string
	literal       string
}

func (in bindingHomeInput) key() string {
	if in.literal != "" {
		return "literal:" + in.literal
	}
	return "binding:" + in.pattern.name + ":" + in.home + ":" + in.options
}

// parseBindingHome reads the keyed form, `binding:<pattern>:<home>:<options>`
// or `literal:<name>`, so a saved corpus file keeps what it tests (RULES.md
// 11), and otherwise reads the choice from the bytes.
func parseBindingHome(data []byte) bindingHomeInput {
	in := bindingHomeInput{pattern: bindingHomePatterns[0], home: bindingHomeHomes[0], options: bindingHomeOptions[0]}
	text := string(data)
	if rest, ok := strings.CutPrefix(text, "literal:"); ok {
		if _, known := bindingHomeLiterals[rest]; known {
			in.literal = rest
		}
		return in
	}
	if rest, ok := strings.CutPrefix(text, "binding:"); ok {
		parts := strings.Split(rest, ":")
		for _, p := range bindingHomePatterns {
			if parts[0] == p.name {
				in.pattern = p
			}
		}
		if len(parts) > 1 && slices.Contains(bindingHomeHomes, parts[1]) {
			in.home = parts[1]
		}
		if len(parts) > 2 && slices.Contains(bindingHomeOptions, parts[2]) {
			in.options = parts[2]
		}
		return in
	}
	at := func(i int) byte {
		if i < len(data) {
			return data[i]
		}
		return 0
	}
	in.pattern = bindingHomePatterns[int(at(0))%len(bindingHomePatterns)]
	in.home = bindingHomeHomes[int(at(1))%len(bindingHomeHomes)]
	in.options = bindingHomeOptions[int(at(2))%len(bindingHomeOptions)]
	return in
}

func bindingHomeSeeds() []string {
	var seeds []string
	for _, p := range bindingHomePatterns {
		for _, options := range []string{"strict", "noUncheckedIndexedAccess"} {
			seeds = append(seeds, "binding:"+p.name+":function:"+options)
		}
	}
	for _, home := range []string{"arrow", "method"} {
		seeds = append(seeds, "binding:exit-success:"+home+":noUncheckedIndexedAccess")
	}
	return append(seeds,
		"binding:exit-success:function:exactOptionalPropertyTypes",
		"binding:exit-success:function:both",
		"binding:object:function:both",
		"binding:error-class:method:both")
}

// bindingHomeProgram prints the .vibe program, or with native its ordinary
// TypeScript counterpart: the same signature returning the counterpart
// expression the Typing table gives the arm.
func bindingHomeProgram(p bindingHomePattern, home string, native bool) string {
	var b strings.Builder
	if native {
		b.WriteString("import { Cause, Data, Exit, Option, Result } from \"effect\"\n\n")
		b.WriteString(p.tsDecls)
	} else {
		b.WriteString(p.decls)
	}
	body := "match (s) {\n    " + p.arm + "\n    default: fallback;\n  }"
	if native {
		body = p.ts
	}
	signature := "<A, E>(s: " + p.subject + ", fallback: " + p.result + "): " + p.result
	switch home {
	case "arrow":
		fmt.Fprintf(&b, "export const pick = %s =>\n  %s;\n", signature, body)
	case "method":
		fmt.Fprintf(&b, "export const picker = {\n  pick%s {\n    return %s;\n  },\n};\n", signature, body)
	default:
		fmt.Fprintf(&b, "export function pick%s {\n  return %s;\n}\n", signature, body)
	}
	return b.String()
}

func bindingHomeConfig(options, file string) string {
	extra := ""
	switch options {
	case "noUncheckedIndexedAccess":
		extra = `"noUncheckedIndexedAccess": true, `
	case "exactOptionalPropertyTypes":
		extra = `"exactOptionalPropertyTypes": true, `
	case "both":
		extra = `"noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true, `
	}
	return fmt.Sprintf(`{"compilerOptions": {%s"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "skipLibCheck": true, "declaration": true, "outDir": "out", "rootDir": "."}, "files": [%q]}`, extra, file)
}

// CheckMatchBindingHomes runs the oracle on one input.
func CheckMatchBindingHomes(t *testing.T, w *Workspace, in bindingHomeInput) {
	const target = "FuzzMatchBindingHomes"
	defer recoverCompilerPanic(t, target)
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
	}
	var vibe, options string
	if in.literal != "" {
		literal := bindingHomeLiterals[in.literal]
		vibe, options = literal.source, literal.options
	} else {
		vibe, options = bindingHomeProgram(in.pattern, in.home, false), in.options
		// The control: the counterpart is ordinary TypeScript and compiles
		// under the same options, or the generated row is wrong.
		native := bindingHomeProgram(in.pattern, in.home, true)
		project := Project{Files: map[string]string{"main.ts": native, "package.json": `{"type":"module"}`}, Config: bindingHomeConfig(options, "main.ts")}
		var c *Compilation
		var err error
		within(t, "control", func() { c, err = w.CompileOrdered(t.Context(), project, OrderTsc, true) })
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		if c.Program == nil || HasError(c.Diagnostics) {
			t.Fatalf("invalid TypeScript counterpart for %s: %v\n%s", in.key(), SortedKeys(Keys(c.Dir, c.Diagnostics)), native)
		}
	}
	g := &Gaps{Target: target, Input: vibe}
	project := Project{Files: map[string]string{"main.vibe": vibe, "package.json": `{"type":"module"}`}, Config: bindingHomeConfig(options, "main.vibe")}
	var c *Compilation
	var err error
	within(t, "compile", func() { c, err = w.CompileOrdered(t.Context(), project, OrderTsc, true) })
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	if c.Program == nil || HasError(c.Diagnostics) {
		g.Add("feature:"+in.key(), "Chapter 4, Typing: \"A `let` binding has the type TypeScript gives the value it is bound to in the counterpart\", whatever the compiler options (%s); the compiler reports %v for:\n%s", options, SortedKeys(Keys(c.Dir, c.Diagnostics)), vibe)
	}
	g.FinishInput(t, key)
}
