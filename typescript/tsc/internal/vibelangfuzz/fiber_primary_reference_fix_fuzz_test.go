package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const fiberPrimaryFixQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestFiberPrimaryReferenceFixQuoted(t *testing.T) {
	for _, quote := range []string{fiberPrimaryFixQuote, refusedRenameFixedPointQuote} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatal(quote)
		}
	}
	if !strings.Contains(SpecText("900-appendices.md"), grammarFiberReferenceQuote) {
		t.Fatal(grammarFiberReferenceQuote)
	}
}

// The repair must not rename an otherwise valid outer declaration: a class
// or function's name and other operations sharing its spelling would change.
// Vary the primary reference, its trivia, and the enclosing Effect form.
func FuzzFiberPrimaryReferenceFix(f *testing.F) {
	startShortBudget(f)
	shapes := []string{"new-class", "heritage-class", "new-member", "new-computed", "heritage-member", "heritage-call", "pattern-import"}
	for _, word := range []string{"fork", "join"} {
		for _, shape := range shapes {
			f.Add(word+":"+shape, byte(0))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestFiberPrimaryReferenceFixQuoted(t)
		parts := strings.Split(key, ":")
		if len(parts) != 2 || parts[0] != "fork" && parts[0] != "join" || !slices.Contains(shapes, parts[1]) {
			t.Skip()
		}
		word, shape := parts[0], parts[1]
		prefix := fmt.Sprintf("class %s { value = 7 }\n", word)
		expression := "new " + word + "().value"
		switch shape {
		case "heritage-class":
			expression = "new (class extends " + word + " {})().value"
		case "new-member", "new-computed", "heritage-member":
			prefix = fmt.Sprintf("const %s = { C: class C { value = 7 } }\n", word)
			expression = "new " + word + ".C().value"
			if shape == "new-computed" {
				expression = "new " + word + "[\"C\"]().value"
			}
			if shape == "heritage-member" {
				expression = "new (class extends " + word + ".C {})().value"
			}
		case "heritage-call":
			prefix = fmt.Sprintf("function %s() { return class C { value = 7 } }\n", word)
			expression = "new (class extends " + word + "() {})().value"
		}
		gap := []string{" ", "/* reference */", "\n", "\t"}[int(variant)%4]
		expression = strings.ReplaceAll(expression, "new "+word, "new"+gap+word)
		expression = strings.ReplaceAll(expression, "extends "+word, "extends"+gap+word)
		head := "export effect function sample() { return " + expression + " }\n"
		switch variant / 4 % 3 {
		case 1:
			head = "export const sample = effect () => " + expression + "\n"
		case 2:
			head = "export const sample = effect { return " + expression + " }\n"
		}
		if shape == "pattern-import" {
			prefix = "import { " + word + " } from \"./model.js\"\n"
			head = "export effect function sample(p: unknown) { const child = fork Effect.succeed(0); const n = join child; return [p is " + word + ", n] }\n"
		}
		source := prefix + head
		input := Single(source)
		if shape == "pattern-import" {
			input.Files["model.ts"] = "export class " + word + " {}\n"
		}
		before, err := w.Compile(t.Context(), input)
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		text := source
		for name, file := range fixed.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				text = file.Text
			}
		}
		if fixed.Err != nil || len(fixed.Refused) != 0 || text == source || shape != "pattern-import" && !strings.HasPrefix(text, prefix) {
			Gap(t, "FuzzFiberPrimaryReferenceFix", key, "%s: reference repair changed its outer declaration or was refused: %v %+v\n%s\nafter:\n%s", fiberPrimaryFixQuote, fixed.Err, fixed.Refused, source, text)
			return
		}
		if shape == "pattern-import" && (!strings.Contains(text, "fork Effect.succeed(0)") || !strings.Contains(text, "join child")) {
			Gap(t, "FuzzFiberPrimaryReferenceFix", key, "%s: import alias changed a written fiber operation:\n%s", fiberPrimaryFixQuote, text)
			return
		}
		input.Files["main.vibe"] = text
		after, err := w.Compile(t.Context(), input)
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if HasError(after.Diagnostics) {
			Gap(t, "FuzzFiberPrimaryReferenceFix", key, "%s: repaired reference does not compile: %v\n%s", fiberPrimaryFixQuote, after.Diagnostics, text)
			return
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			Gap(t, "FuzzFiberPrimaryReferenceFix", key, "%s: repair did not reach a fixed point: %v %+v", fiberPrimaryFixQuote, again.Err, again.Refused)
			return
		}
		ExpectPending(t, "FuzzFiberPrimaryReferenceFix", key)
		ExpectPending(t, "FuzzFiberPrimaryReferenceFix", specCorpusKey(t))
	})
}
