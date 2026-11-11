package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// FuzzReturnedCallableCalls calls the callable a foreign factory returns, as
// make(c)(e), from plain and effect code. Chapter 3, Thrown types: tags
// attach to call signatures, and the signature of a returned callable carries
// its own tag. A signature with no tag throws unknown: in plain code such a
// call stays an ordinary call, and in effect code it needs its wrapper
// (EK0403). A written tag other than @throws {never} makes the call known to
// throw, which plain code outside a try/catch rejects (EK0401). So the two
// calls in make(c)(e) are judged separately, each by its own signature, and
// the expected codes are one per call that breaks its host rule.
//
// The key is <outer>/<inner>/<spelling>/<signature>/<form>/<host>: the tag
// on make and the tag on the returned signature (none, never, Error,
// unknown); how foreign.ts writes the returned type (inline in a function
// return type, a type alias of an object type with a call signature, the
// return type of an arrow const, a typed declare const); a monomorphic or
// generic returned signature; the call form (direct, parenthesized, bound to
// a const); and the .vibe host (exported arrow, function, class method,
// try/catch in a function, effect function). When a plain host compiles with
// no error, its declaration carries exactly @throws {never} (Chapter 1,
// Thrown types).

const returnedCallableCallsTarget = "FuzzReturnedCallableCalls"

var returnedCallableCallsQuotes = []string{
	returnedSignatureQuote,
	"| no tag | `unknown` |",
	"A call whose throwing is unknown, such as an unannotated `.ts` function, stays an ordinary call",
	"Its callee has a written `@throws {T}` other than `@throws {never}` (`@throws {unknown}` included)",
	"unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function",
	"In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`.",
}

const returnedCallableCallsDeclarationQuote = "so the output states the same on every call signature it emits other than an effectful one"

var returnedCallableContracts = []string{"none", "never", "Error", "unknown"}

type returnedCallableCase struct {
	key, outer, inner, spelling, signature, form, host string
}

func returnedCallableCases() []returnedCallableCase {
	var cases []returnedCallableCase
	for _, outer := range returnedCallableContracts {
		for _, inner := range returnedCallableContracts {
			for _, spelling := range []string{"inline", "alias", "arrow-const", "typed-const"} {
				for _, signature := range []string{"mono", "generic"} {
					for _, form := range []string{"direct", "paren", "bound"} {
						for _, host := range []string{"arrow", "function", "method", "try", "effect"} {
							key := strings.Join([]string{outer, inner, spelling, signature, form, host}, "/")
							cases = append(cases, returnedCallableCase{key, outer, inner, spelling, signature, form, host})
						}
					}
				}
			}
		}
	}
	return cases
}

func returnedCallableTag(contract, indent string) string {
	if contract == "none" {
		return ""
	}
	return indent + "/** @throws {" + contract + "} */\n"
}

// foreign is foreign.ts, whose make(c) returns the callable.
func (c returnedCallableCase) foreign() string {
	arrow, member, impl := "(e: number) => number", "(e: number): number", "(e: number) => c + e"
	if c.signature == "generic" {
		arrow, member, impl = "<A>(e: A) => A", "<A>(e: A): A", "<A>(e: A) => e"
	}
	returned := "(\n" + returnedCallableTag(c.inner, "  ") + "  " + arrow + "\n)"
	outer := returnedCallableTag(c.outer, "")
	switch c.spelling {
	case "alias":
		return "export type Runner = {\n" + returnedCallableTag(c.inner, "  ") + "  " + member + "\n}\n" + outer + "export function make(c: number): Runner {\n  return " + impl + "\n}\n"
	case "arrow-const":
		return outer + "export const make = (c: number): " + returned + " => " + impl + "\n"
	case "typed-const":
		return outer + "export declare const make: (c: number) => " + returned + "\n"
	}
	return outer + "export function make(c: number): " + returned + " {\n  return " + impl + "\n}\n"
}

func (c returnedCallableCase) main() string {
	body := map[string]string{
		"direct": "return make(c)(e)",
		"paren":  "return (make(c))(e)",
		"bound":  "const g = make(c)\n  return g(e)",
	}[c.form]
	var host string
	switch c.host {
	case "arrow":
		host = "export const probe = (c: number, e: number) => {\n  " + body + "\n}\n"
	case "function":
		host = "export function probe(c: number, e: number) {\n  " + body + "\n}\n"
	case "method":
		host = "export class Box {\n  run(c: number, e: number) {\n  " + body + "\n  }\n}\n"
	case "try":
		host = "export function probe(c: number, e: number) {\n  try {\n  " + body + "\n  } catch {\n    return 0\n  }\n}\n"
	default:
		host = "export effect function probe(c: number, e: number) {\n  " + body + "\n}\n"
	}
	return "import { make } from \"./foreign.js\"\n\n" + host
}

// want holds one code for each of the two calls that breaks its host rule.
func (c returnedCallableCase) want() []string {
	var want []string
	for _, contract := range []string{c.outer, c.inner} {
		switch c.host {
		case "arrow", "function", "method":
			if contract == "Error" || contract == "unknown" {
				want = append(want, "EK0401")
			}
		case "effect":
			if contract != "never" {
				want = append(want, "EK0403")
			}
		}
	}
	return want
}

// declarationTags is the @throws list the declaration of a plain host must
// carry when it compiles with no error, or nil when none is checked.
func (c returnedCallableCase) declarationTags() []string {
	if c.host == "effect" {
		return nil
	}
	return []string{"never"}
}

// gapKey folds the signature and the call form into one pending key for an
// untagged returned signature written inside the declaration of make; each
// such pending family fails in all six of its cells.
func (c returnedCallableCase) gapKey() string {
	if c.inner == "none" && c.spelling != "alias" {
		return "untagged-returned/" + c.spelling + "/" + c.outer + "/" + c.host
	}
	return c.key
}

var returnedCallableThrowsTag = regexp.MustCompile(`@throws \{([^}]*)\}`)

func returnedCallableCompare(t *testing.T, w *Workspace, key, gapKey string, files map[string]string, want, tags []string) {
	t.Helper()
	r, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	got := r3Errors(r.Diagnostics)
	slices.Sort(got)
	if !slices.Equal(got, want) {
		var lines []string
		for _, d := range r.Diagnostics {
			lines = append(lines, describe(d))
		}
		Gap(t, returnedCallableCallsTarget, gapKey, "Chapter 3: %q; %s: got %v, want %v\n%s\n%s", returnedSignatureQuote, key, got, want, strings.Join(lines, "\n"), Archive(files))
		return
	}
	if len(want) == 0 && tags != nil {
		declaration := r.Outputs["out/main.d.ts"]
		if declaration == "" {
			t.Fatalf("%s: no main.d.ts; outputs %v", key, slices.Sorted(maps.Keys(r.Outputs)))
		}
		var written []string
		for _, m := range returnedCallableThrowsTag.FindAllStringSubmatch(declaration, -1) {
			written = append(written, m[1])
		}
		if !slices.Equal(written, tags) {
			Gap(t, returnedCallableCallsTarget, gapKey, "Chapter 1: %q; %s: main.d.ts has @throws %v, want %v\n%s", returnedCallableCallsDeclarationQuote, key, written, tags, declaration)
			return
		}
	}
	ExpectPending(t, returnedCallableCallsTarget, gapKey)
}

func TestReturnedCallableCallsQuoted(t *testing.T) {
	r4Quoted(t, failuresChapter, returnedCallableCallsQuotes...)
	r4Quoted(t, "001-functions.md", returnedCallableCallsDeclarationQuote)
}

// TestReturnedCallableCallsWitness compiles the Smithers minimum: plain
// runners that call Effect.runSyncWith(c)(e) and Effect.runSync(e). Neither
// signature carries a tag, so both calls stay ordinary calls, and both
// declarations carry the generated @throws {never}.
func TestReturnedCallableCallsWitness(t *testing.T) {
	TestReturnedCallableCallsQuoted(t)
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "smithers-runsyncwith-curried.json"))
	if err != nil {
		t.Fatal(err)
	}
	var witness struct{ Source, Main string }
	if err := json.Unmarshal(raw, &witness); err != nil {
		t.Fatal(err)
	}
	returnedCallableCompare(t, NewWorkspace(t), witness.Source, "witness:smithers-runsyncwith-curried", map[string]string{"main.vibe": witness.Main}, nil, []string{"never", "never"})
}

func FuzzReturnedCallableCalls(f *testing.F) {
	startShortBudget(f)
	cases := returnedCallableCases()
	f.Add("never/none/inline/mono/direct/effect")
	f.Add("Error/none/typed-const/generic/bound/function")
	f.Add("none/none/typed-const/generic/direct/arrow")
	f.Add("never/Error/alias/mono/paren/method")
	f.Add("unknown/never/arrow-const/generic/bound/try")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestReturnedCallableCallsQuoted(t)
		i := slices.IndexFunc(cases, func(c returnedCallableCase) bool { return c.key == key })
		if i < 0 {
			i = len(key) % len(cases)
		}
		c := cases[i]
		returnedCallableCompare(t, w, c.key, c.gapKey(), map[string]string{"main.vibe": c.main(), "foreign.ts": c.foreign()}, c.want(), c.declarationTags())
		ExpectPending(t, returnedCallableCallsTarget, specCorpusKey(t))
	})
}

func TestReturnedCallableCallsNeighborhood(t *testing.T) {
	if testing.Short() && os.Getenv("VIBELANG_RETURNED_CALLS_MATRIX") == "" {
		t.Skip("the complete contract, spelling, signature, form and host matrix runs separately")
	}
	TestReturnedCallableCallsQuoted(t)
	w := NewWorkspace(t)
	for _, c := range returnedCallableCases() {
		t.Run(c.key, func(t *testing.T) {
			returnedCallableCompare(t, w, c.key, c.gapKey(), map[string]string{"main.vibe": c.main(), "foreign.ts": c.foreign()}, c.want(), c.declarationTags())
		})
	}
}
