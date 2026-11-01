package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

// Functions, "The A!E!R type shorthand" (VIP-3).
var danglingBangQuotes = []string{
	"each `!`, and the slot after it, start on the line where the previous slot ends, and a slot in parentheses may span lines",
	"syntax error (TS17019): this ! has no slot on its line",
}

func requireDanglingBangQuotes(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range danglingBangQuotes {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("missing shorthand line-break rule: %q", quote)
		}
	}
}

func TestEffectTypeDanglingBangQuoted(t *testing.T) { requireDanglingBangQuotes(t) }

// danglingBangForms maps a key to a declaration and the number of TS17019
// diagnostics the rule gives it. `loaded` has the Effect type each form
// names, so a form that parses has no other error.
var danglingBangForms = map[string]struct {
	source string
	want   int
}{
	"newline-slot":               {"declare const loaded: User!NotFound\nexport const b: User!\n  NotFound = loaded", 1},
	"newline-end":                {"declare const loaded: User!!\nexport const b: User!\nexport const c = loaded", 1},
	"equals":                     {"declare const loaded: User!!\nexport const e: User! = loaded", 1},
	"alias":                      {"export type T = string!", 1},
	"return-newline":             {"export effect function f(): number!\n{ return 1 }", 1},
	"double-bang-newline":        {"declare const loaded: User!!\nexport const ok: User!!\n  = loaded", 0},
	"double-bang-equals":         {"declare const loaded: User!!\nexport const ok: User!!= loaded", 0},
	"double-bang-end":            {"declare const loaded: User!!\nexport const ok: User!!\nexport const c = loaded", 0},
	"parenthesized-slot":         {"declare const loaded: User!(NotFound | Timeout)\nexport const ok: User!(\n  NotFound | Timeout) = loaded", 0},
	"slot":                       {"declare const loaded: User!NotFound\nexport const ok: User!NotFound = loaded", 0},
	"three-slots":                {"declare const loaded: User!NotFound!Users\nexport const ok: User!NotFound!Users = loaded", 0},
	"return-double-bang":         {"export effect function f(): number!! { return 1 }", 0},
	"interface-two-members":      {"export interface Clock {\n  now(): number!!\n  later(): number!!\n}", 0},
	"tuple-optional-double-bang": {"export type Opt = [User!!?]", 0},
	"tuple-optional-slot":        {"export type Opt = [User!NotFound?]", 0},
}

const danglingBangPrelude = "type User = { id: number }\ntype NotFound = { _tag: \"NotFound\" }\ntype Timeout = { _tag: \"Timeout\" }\ntype Users = { users: true }\n"

func FuzzEffectTypeDanglingBang(f *testing.F) {
	startShortBudget(f)
	requireDanglingBangQuotes(f)
	for key := range danglingBangForms {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		form, ok := danglingBangForms[key]
		if !ok {
			key, form = "newline-slot", danglingBangForms["newline-slot"]
		}
		source := danglingBangPrelude + form.source
		if mode%2 == 1 {
			// Comments and a Unicode prefix move offsets without moving lines.
			source = "// café 😀 User!⏎ comment\n" + strings.Replace(source, "!", "/* ! */!", 1)
		}
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count, typeExpected := 0, 0
		for _, d := range result.Diagnostics {
			switch d.Code() {
			case 17019:
				count++
			case 1110:
				typeExpected++ // Type expected: a JSDoc ? or * taken as a slot start
			}
		}
		if form.want == 0 && typeExpected != 0 {
			Gap(t, "FuzzEffectTypeDanglingBang", "bang:"+key, "%s; got %d TS1110 on a valid shorthand\n%s\n%v", danglingBangQuotes[0], typeExpected, source, result.Diagnostics)
		}
		if count != form.want {
			Gap(t, "FuzzEffectTypeDanglingBang", "bang:"+key, "%s; got %d TS17019, want %d\n%s\n%v", danglingBangQuotes[0], count, form.want, source, result.Diagnostics)
		}
	})
}
