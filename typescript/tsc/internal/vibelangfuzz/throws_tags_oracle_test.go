package vibelangfuzz

import (
	"strings"
	"testing"
)

const nativeCallableBindingQuote = "Each keeps its source form: a function declaration is a `declare function`, and a `const` holding an arrow is a `declare const`."

func TestThrowsTagsNativeBindingQuoted(t *testing.T) {
	for _, quote := range []string{nativeCallableBindingQuote, declarationThrowsContractQuote} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			t.Fatalf("Chapter 1 no longer contains %q", quote)
		}
	}
}

func TestThrowsTagsNativeBinding(t *testing.T) {
	for _, declaration := range []string{
		"export declare const add: (a: number, b: number) => number;",
		"export declare const add: <T>(value: T) => T;",
		"export declare const add: () => Promise<number>;",
	} {
		for _, file := range []string{"main.d.ts", "main.d.vibe.ts"} {
			for _, tag := range []string{"", "/** @throws {unknown} */\n", "/** @throws {never} */\n"} {
				problems := checkThrowsTags(map[string]string{file: tag + declaration}, map[string]string{"add": "{never}"})
				if valid := strings.Contains(tag, "{never}"); (len(problems) == 0) != valid {
					t.Fatalf("native binding contract oracle: %q in %s: %v", tag+declaration, file, problems)
				}
			}
		}
	}
}
