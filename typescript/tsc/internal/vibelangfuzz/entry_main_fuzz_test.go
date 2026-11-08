package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const entryMainQuote = "There is no magic entry point. A function named `main` is an ordinary function, and you run it with a runner yourself, exactly as in Effect TypeScript."

func TestEntryMainQuoted(t *testing.T) {
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), entryMainQuote) {
		t.Fatalf("chapter 1 no longer says %q", entryMainQuote)
	}
}

var entryMainForms = []struct{ key, declaration, tail string }{
	{"const-arrow", "export const main = () => 7", ""},
	{"let-arrow", "export let main = () => 7", ""},
	{"const-expression", "export const main = function () { return 7 }", ""},
	{"const-named-expression", "export const main = function main() { return 7 }", ""},
	{"let-expression", "export let main = function () { return 7 }", ""},
	{"let-named-expression", "export let main = function main() { return 7 }", ""},
	{"self-binding", "export const main = function main(): unknown { return main }", ""},
	{"writable-let", "export let main = () => 7", "\nmain = () => 9"},
	{"annotated", "export const main: () => number = () => 7", ""},
	{"async-arrow", "export const main = async () => 7", ""},
	{"effect-arrow", "export const main = effect () => 7", ""},
	{"parameters", "export const main = (n = 7) => n", ""},
}
