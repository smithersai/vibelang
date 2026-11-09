package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const rejectedTryTarget = "FuzzRejectedTryType"

// Chapter 2 ties try's placement to await's, and TypeScript types an await
// it rejects as the value it would give. A try outside effect code is EK0501,
// and every other diagnostic must be what the await twin reports beside its
// own placement error, so a rejected try adds no derived type error.
const rejectedTryQuote = "`try e` is allowed, forbidden and ordered exactly where `await e` is"

func TestRejectedTryTypeQuoted(t *testing.T) { chapterSays(t, "002-running.md", rejectedTryQuote) }

var rejectedTryPositions = []string{"plain-body", "plain-body-inline", "nested-plain", "nested-plain-inline", "parameter-default", "parameter-default-inline", "class-field", "class-field-inline", "static-block", "static-block-inline", "top-level", "top-level-inline", "heritage-plain", "heritage-plain-inline", "heritage-default", "heritage-default-inline"}

// Each use reads the run value: as is under a matching or a mismatched
// annotation, through a member, and through a method call.
var rejectedTryUses = []struct{ key, typ, expr string }{
	{"fits", "string", "E"},
	{"mismatch", "number", "E"},
	{"member", "number", "E.length"},
	{"method", "string", "E.toUpperCase()"},
}

// awaitPlacementCodes are TypeScript's errors for an await where its context
// forbids one; EK0501 is the try twin's.
var awaitPlacementCodes = []int32{1103, 1308, 1375, 1378, 2524, 18037}

func FuzzRejectedTryType(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", rejectedTryQuote)
	w := NewWorkspace(f)
	for _, position := range rejectedTryPositions {
		for i, use := range rejectedTryUses {
			f.Add(position+":"+use.key, uint8(i))
		}
	}
	f.Fuzz(func(t *testing.T, position string, variant uint8) {
		position, useKey, keyed := strings.Cut(position, ":")
		if !slices.Contains(rejectedTryPositions, position) {
			position = rejectedTryPositions[int(variant)%len(rejectedTryPositions)]
		}
		index := int(variant) % len(rejectedTryUses)
		if keyed {
			for i, use := range rejectedTryUses {
				if use.key == useKey {
					index = i
					break
				}
			}
		}
		use := rejectedTryUses[index]
		vibe, twin := rejectedTryProgram(position, use.typ, use.expr)
		baseline, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.ts": twin}, Config: fmt.Sprintf(errorTwinConfig, "main.ts")}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer baseline.Remove()
		var want []string
		placed := 0
		for _, d := range baseline.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if slices.Contains(awaitPlacementCodes, d.Code()) {
				placed++
				continue
			}
			want = append(want, fmt.Sprintf("TS%d %s", d.Code(), d.MessageText()))
		}
		result, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.vibe": vibe}, Config: fmt.Sprintf(errorTwinConfig, "main.vibe")}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var got []string
		rejected := 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 501 {
				rejected++
				continue
			}
			prefix := "TS"
			if IsEK(d) {
				prefix = "EK"
			}
			got = append(got, fmt.Sprintf("%s%d %s", prefix, d.Code(), d.MessageText()))
		}
		slices.Sort(got)
		slices.Sort(want)
		key := position + ":" + use.key
		// The top level admits await but not try (VIP-26), so only the try
		// twin has a placement error there.
		if rejected != 1 || strings.TrimSuffix(position, "-inline") != "top-level" && placed == 0 {
			t.Fatalf("witness lost its placement errors: EK0501 x%d, await errors x%d\n%s\n%s", rejected, placed, vibe, twin)
		}
		if !slices.Equal(got, want) {
			Gap(t, rejectedTryTarget, "diagnostics:"+key, "%s\nVibe, besides EK0501: %q\nTypeScript, besides its await error: %q\n%s\n%s", rejectedTryQuote, got, want, vibe, twin)
		}
		ExpectPending(t, rejectedTryTarget, "diagnostics:"+key)
		ExpectPending(t, rejectedTryTarget, specCorpusKey(t))
	})
}

// rejectedTryProgram writes the use at position twice: with try of an Effect
// in a .vibe file, and with await of a Promise of the same value in its
// TypeScript twin, where effect callables become async ones.
func rejectedTryProgram(position, typ, expr string) (string, string) {
	inline := strings.HasSuffix(position, "-inline")
	position = strings.TrimSuffix(position, "-inline")
	body := map[string]string{
		"plain-body":        "export function f() { const s: T = X; return s }",
		"nested-plain":      "export K function f() { function g() { const s: T = X; return s }; return g }",
		"parameter-default": "export K function f(s: T = X) { return s }",
		"class-field":       "export K function f() { class C { s: T = X }; return C }",
		"static-block":      "export K function f() { class C { static { const s: T = X; void s } }; return C }",
		"top-level":         "export const s: T = X",
		"heritage-plain":    "export function f() { class C extends (B) {}; return new C().v }",
		"heritage-default":  "export K function f(c = class extends (B) {}) { return c }",
	}[position]
	write := func(keyword, run, value, base string) string {
		program := strings.NewReplacer("T", typ, "X", strings.ReplaceAll(expr, "E", "("+run+" "+value+")"), "K", keyword, "B", run+" "+base).Replace(body)
		return program
	}
	vibeValue, vibeBase, twinValue, twinBase := "k", "b", "k", "b"
	if inline {
		vibeValue, vibeBase = "Effect.succeed(\"m\")", "Effect.succeed(class { v = 1 })"
		twinValue, twinBase = "Promise.resolve(\"m\")", "Promise.resolve(class { v = 1 })"
	}
	vibe := "const k = Effect.succeed(\"m\")\nconst b = Effect.succeed(class { v = 1 })\n" + write("effect", "try", vibeValue, vibeBase) + "\n"
	twin := "declare const k: Promise<string>\ndeclare const b: Promise<{ new (): { v: number } }>\n" + write("async", "await", twinValue, twinBase) + "\n"
	return vibe, twin
}
