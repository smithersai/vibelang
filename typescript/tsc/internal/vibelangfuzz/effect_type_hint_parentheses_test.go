package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const effectHintParenthesesTarget = "FuzzEffectTypeHintParentheses"
const effectHintParenthesesQuote = "Use the equivalent `A!E!R` spelling, preserving `never` slots and required parentheses."

var effectHintHomes = []string{"alias", "return", "argument", "array"}
var effectHintUnions = []struct{ key, left, right string }{
	{"number-string", "number", "string"},
	{"boolean-bigint", "boolean", "bigint"},
	{"string-undefined", "string", "undefined"},
}
var effectHintSlots = []struct{ key, args, suffix string }{
	{"one", "", "!!"},
	{"error", ", Error", "!Error"},
	{"three", ", Error, Req", "!Error!Req"},
	{"requirements", ", never, Req", "!!Req"},
}

func effectTypeHintParenthesesQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), legacyEffectAliasQuote) {
		t.Fatalf("Chapter 7 no longer says %q", legacyEffectAliasQuote)
	}
	if !strings.Contains(SpecText("007-tooling.md"), effectHintParenthesesQuote) {
		t.Fatalf("Chapter 7 no longer says %q", effectHintParenthesesQuote)
	}
}

func TestEffectTypeHintParenthesesQuoted(t *testing.T) { effectTypeHintParenthesesQuoted(t) }

func effectHintSource(home, success, args string) string {
	typ := "Effect.Effect<" + success + args + ">"
	switch home {
	case "return":
		typ = "() => " + typ
	case "argument":
		typ = "Array<" + typ + ">"
	case "array":
		typ += "[]"
	}
	return "type Req = { readonly needed: true }\nexport type Sample = " + typ + "\n"
}

func effectHintMessages(t testing.TB, w *Workspace, source string) []string {
	t.Helper()
	r, err := w.Compile(t.Context(), Single(source))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var messages []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("the written qualified Effect type must compile: %s\n%s", d.String(), source)
		}
		if d.Source() == "EK" && d.Code() == 4833 {
			messages = append(messages, d.String())
		}
	}
	return messages
}

// Chapter 7 requires a parenthesized union in EK4833's proposed success
// slot. Inputs vary the containing type and E/R slots. A non-union
// control checks the diagnostic before any pending gap can end a case.
func FuzzEffectTypeHintParentheses(f *testing.F) {
	startShortBudget(f)
	effectTypeHintParenthesesQuoted(f)
	w := NewWorkspace(f)
	control := effectHintMessages(f, w, effectHintSource("alias", "number", ""))
	if len(control) != 1 || !strings.Contains(strings.Join(strings.Fields(control[0]), ""), "number!!") {
		f.Fatalf("the non-union EK4833 control must suggest number!!: %v", control)
	}
	var keys []string
	for _, home := range effectHintHomes {
		for _, union := range effectHintUnions {
			for _, slots := range effectHintSlots {
				key := home + ":" + union.key + ":" + slots.key
				keys = append(keys, key)
				f.Add([]byte(key))
			}
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		effectTypeHintParenthesesQuoted(t)
		key := string(data)
		i := slices.Index(keys, key)
		if i < 0 {
			i = 0
			for _, b := range data {
				i = (i*33 + int(b)) % len(keys)
			}
			key = keys[i]
		}
		home := effectHintHomes[i/(len(effectHintUnions)*len(effectHintSlots))]
		union := effectHintUnions[i/len(effectHintSlots)%len(effectHintUnions)]
		slots := effectHintSlots[i%len(effectHintSlots)]
		source := effectHintSource(home, union.left+" | "+union.right, slots.args)
		messages := effectHintMessages(t, w, source)
		if len(messages) != 1 {
			t.Fatalf("one written Effect reference needs one EK4833 advisory: %v\n%s", messages, source)
		}
		compact := strings.Join(strings.Fields(messages[0]), "")
		// Either union order preserves its meaning. A retained explicit
		// never in E and extra surrounding parentheses are also valid.
		suffixes := []string{slots.suffix}
		if slots.key == "requirements" {
			suffixes = append(suffixes, "!never!Req")
		}
		valid := false
		for _, suffix := range suffixes {
			for _, order := range []string{union.left + "|" + union.right, union.right + "|" + union.left} {
				valid = valid || strings.Contains(compact, "("+order+")"+suffix)
			}
		}
		gap := "hint:" + key
		if !valid {
			Gap(t, effectHintParenthesesTarget, gap, "Chapter 7 %q: the suggested success union must keep its parentheses; got %s\n%s", effectHintParenthesesQuote, messages[0], source)
		}
		ExpectPending(t, effectHintParenthesesTarget, gap)
		ExpectPending(t, effectHintParenthesesTarget, specCorpusKey(t))
	})
}

// Chapter 7: a quick fix is offered when it preserves declaration output, and
// EK4833's shorthand keeps required parentheses. Parentheses the fix adds never
// reach declarations, so the grouped hint is applied, and declarations stay
// byte-identical (VIP-3, amended 2026-11-04).
func TestEffectTypeHintGroupingFixKeepsDeclarations(t *testing.T) {
	effectTypeHintParenthesesQuoted(t)
	w := NewWorkspace(t)
	const config = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"types":[],"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`
	compile := func(t *testing.T, source string) (*Result, string) {
		t.Helper()
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": `{"type":"module"}`}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		if !toolsErrorFree(r) {
			t.Fatalf("must compile: %v\n%s", SortedKeys(Keys(r.Dir, r.Diagnostics)), source)
		}
		for output, text := range r.Outputs {
			if strings.HasSuffix(output, "/main.d.ts") {
				return r, text
			}
		}
		t.Fatalf("missing main.d.ts\n%s", source)
		return r, ""
	}
	for _, home := range effectHintHomes {
		for _, slots := range effectHintSlots {
			t.Run(home+":"+slots.key, func(t *testing.T) {
				source := effectHintSource(home, "number | string", slots.args)
				before, declaration := compile(t, source)
				defer before.Remove()
				warnings := 0
				for _, d := range before.Diagnostics {
					if d.Source() == "EK" && d.Code() == 4833 {
						warnings++
						if !strings.Contains(d.String(), "(number | string)") {
							t.Fatalf("the advisory lost the grouped success slot: %s", d.String())
						}
					}
				}
				if warnings != 1 {
					t.Fatalf("want one EK4833, got %d", warnings)
				}
				fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
				if fixed.Err != nil || len(fixed.Files) != 1 || len(fixed.Refused) != 0 {
					t.Fatalf("%s: the grouped hint must be applied; files=%d, refused=%v, err=%v", legacyEffectAliasQuote, len(fixed.Files), fixed.Refused, fixed.Err)
				}
				var text string
				for _, file := range fixed.Files {
					text = file.Text
				}
				if strings.Contains(text, "Effect.Effect<") || !strings.Contains(text, "(number | string)") {
					t.Fatalf("%s: want the grouped shorthand, --fix wrote\n%s", effectHintParenthesesQuote, text)
				}
				after, got := compile(t, text)
				defer after.Remove()
				if got != declaration {
					t.Fatalf("%s: declarations changed\nbefore:\n%s\nafter:\n%s", legacyEffectAliasQuote, declaration, got)
				}
			})
		}
	}
}
