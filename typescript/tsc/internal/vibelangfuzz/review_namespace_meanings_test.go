package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const reviewNamespaceMeaningsTarget = "FuzzReviewNamespaceMeanings"
const reviewNamespaceMeaningsQuote = "**Precedence applies per meaning, as in TypeScript.** In a type position, a bare name declared as a type by an ambient global declaration (a TypeScript `lib` file or `@types`) keeps that meaning (including the DOM's `Console`, `FileSystem`, `Headers`, `Response` and `Event`)."
const reviewNamespaceFreshQuote = "Emitted namespace imports use fresh names so they do not shadow those global types."

func TestReviewNamespaceMeaningsQuoted(t *testing.T) {
	for _, quote := range []string{reviewNamespaceMeaningsQuote, reviewNamespaceFreshQuote} {
		if !strings.Contains(SpecText("005-services.md"), quote) {
			t.Fatalf("Chapter5 no longer says %q; update the namespace oracle", quote)
		}
	}
}

func reviewNamespaceMeaningPair(name string, form uint8, local bool) [2]string {
	module, member := "effect/crypto", "jwk"
	if name == "Transferable" {
		module, member = "effect/workers", "makeCollectorUnsafe"
	}
	types := []string{
		"export type Ambient = " + name + ";\n",
		"export type Ambient = ReadonlyArray<" + name + ">;\n",
		"export type Ambient = { readonly value?: " + name + " };\n",
		"export function keep(value: " + name + "): " + name + " { return value }\n",
		"export function keep<T extends " + name + ">(value: T): T { return value }\n",
		"export type Ambient<T> = T extends " + name + " ? true : false;\n",
	}
	head := ""
	if local {
		head = "type " + name + " = { readonly local: true };\n"
		if form >= 6 {
			head = "interface " + name + " { readonly local: true }\n"
		}
	}
	body := head + types[int(form)%len(types)]
	return [2]string{
		body + "export const foreign = " + name + "." + member + ";\n",
		fmt.Sprintf("import { %s as NativeNamespace } from %q;\n", name, module) +
			body + "export const foreign = NativeNamespace." + member + ";\n",
	}
}

// R3 OPUS-10: both omitted collisions are type-only DOM globals. The same
// program must keep its ambient/local type and use Effect's module in the
// value/namespace meaning. The counterpart imports that module under a fresh
// name; it does not read the compiler's chosen implicit-import rendering.
func FuzzReviewNamespaceMeanings(f *testing.F) {
	startShortBudget(f)
	for _, name := range []string{"KeyFormat", "Transferable"} {
		for form := range uint8(12) {
			for _, local := range []bool{false, true} {
				if form >= 6 && !local {
					continue // Interfaces add a local-type variant only.
				}
				f.Add(name, form, local)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, name string, form uint8, local bool) {
		TestReviewNamespaceMeaningsQuoted(t)
		if name != "Transferable" {
			name = "KeyFormat"
		}
		form %= 12
		pair := reviewNamespaceMeaningPair(name, form, local)
		key := fmt.Sprintf("%s:%d:%t", name, form, local)
		for _, index := range []int{1, 0} {
			file := "main.ts"
			if index == 0 {
				file = "main.vibe"
			}
			var result *Result
			var err error
			within(t, "check namespace meaning", func() {
				result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: pair[index]}})
			})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				if index == 1 {
					t.Fatalf("invalid explicit TypeScript counterpart: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), pair[index])
				}
				Gap(t, reviewNamespaceMeaningsTarget, key,
					"Chapter5: %q; native implicit namespace rejects a valid explicit counterpart: %v\n%s",
					reviewNamespaceMeaningsQuote, SortedKeys(Keys(result.Dir, result.Diagnostics)), pair[index])
			}
		}
		ExpectPending(t, reviewNamespaceMeaningsTarget, key)
		ExpectPending(t, reviewNamespaceMeaningsTarget, specCorpusKey(t))
	})
}
