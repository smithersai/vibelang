package vibelangfuzz

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const foreignNoteTarget = "FuzzForeignCallNoteForms"

// The repairs chapter 900 names for EK0403, the first being the defect bridge.
const foreignNoteRepairs = "| `EK0403` | an unwrapped call, `new` expression, tagged template or class evaluation that may throw, in effect code; quick fixes: first wrap with `try Effect.orDie(Effect.try({ try: () => call(), catch: (e) => e }))` to preserve defects and E"

// The empty legacy wrapper is no accepted form, so a note must not name it.
const foreignNoteRetired = "The historical `trusted(f, [])` runtime wrapper is not an accepted VIP form."

// foreignNoteForms reads the two forms from EK0403's note.
var foreignNoteForms = regexp.MustCompile(`Call it through (.+?), or keep its exceptions as defects with (.+?)\.(?:\n|$)`)

func TestForeignCallNoteFormsQuoted(t *testing.T) {
	for _, quote := range []struct{ chapter, text string }{
		{failuresChapter, foreignDiagnosticRule},
		{grammarAppendix, foreignNoteRepairs},
		{"../vips/0004-throw.md", foreignNoteRetired},
	} {
		if !strings.Contains(SpecText(quote.chapter), quote.text) {
			t.Fatalf("%s no longer says %q", quote.chapter, quote.text)
		}
	}
}

// FuzzForeignCallNoteForms checks EK0403's note against the checker. Over
// chapter 3's foreign-call shapes and positions, each form the note names,
// "Wrap it: `try Effect.try(() => parse(s))`" and the chapter 900 defect
// bridge, written in place of the reported call, leaves the program without
// an error. The note once named trusted(f, [Errors]), which is EK0402 for an
// unannotated foreign function, so following it traded one error for another.
func FuzzForeignCallNoteForms(f *testing.F) {
	startShortBudget(f)
	keys := []string{"library-unannotated", "library-unknown-tag", "interface-member", "foreign-const", "foreign-method", "foreign-overload", "foreign-function-property", "foreign-function-field"}
	var cases []*failCase
	for _, key := range keys {
		i := slices.IndexFunc(failuresCases(), func(c *failCase) bool { return c.Name == key })
		if i < 0 {
			f.Fatalf("missing foreign-call case %s", key)
		}
		cases = append(cases, failuresCases()[i])
		f.Add(key, uint8(0))
		f.Add(key, uint8(9))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		TestForeignCallNoteFormsQuoted(t)
		i := slices.Index(keys, key)
		if i < 0 {
			i = len(key) % len(keys)
		}
		c := *cases[i]
		switch choice % 3 {
		case 1:
			c.Body = "const held = " + c.Body
		case 2:
			c.Body = "void (" + c.Body + ")"
		}
		files, span := failuresProject(&c, choice)
		gapKey := fmt.Sprintf("note:%s:%d", keys[i], choice%3)
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		var note string
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 403 && d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/main.vibe") && d.Pos() <= span[1] && d.End() >= span[0] {
				var b strings.Builder
				flatten(&b, d, 0)
				note = b.String()
			}
		}
		r.Remove()
		if note == "" {
			t.Skipf("no EK0403 at the call; FuzzForeignCallDiagnostic owns that oracle\n%s", Archive(files))
		}
		if strings.Contains(note, "trusted(") {
			Gap(t, foreignNoteTarget, gapKey, "VIP-4: %s EK0403's note names the trusted wrapper:\n%s", foreignNoteRetired, note)
		}
		forms := foreignNoteForms.FindStringSubmatch(note)
		if forms == nil && strings.Contains(note, "Wrap the call with 'try Effect.try(() => …)'") {
			// A written @throws {unknown} contract gets the contract message,
			// whose hint is a pattern, not a form to compile.
			ExpectPending(t, foreignNoteTarget, gapKey)
			return
		}
		if forms == nil {
			Gap(t, foreignNoteTarget, gapKey, "%s: the note names no Effect.try form and defect bridge:\n%s", foreignNoteRepairs, note)
		}
		main := files["main.vibe"]
		for _, form := range forms[1:] {
			if strings.Contains(form, "; try ") {
				continue // statements that bind an Effect operand first; these shapes have none
			}
			fixed := map[string]string{}
			for name, text := range files {
				fixed[name] = text
			}
			fixed["main.vibe"] = main[:span[0]] + form + main[span[1]:]
			r, err := w.Compile(t.Context(), Project{Files: fixed})
			if err != nil {
				t.Fatal(err)
			}
			var errors []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, describe(d))
				}
			}
			r.Remove()
			if len(errors) != 0 {
				Gap(t, foreignNoteTarget, gapKey, "%s; %s: the note's form %s does not compile: %v\n%s", foreignDiagnosticRule, foreignNoteRepairs, form, errors, Archive(fixed))
			}
		}
		ExpectPending(t, foreignNoteTarget, gapKey)
	})
}
