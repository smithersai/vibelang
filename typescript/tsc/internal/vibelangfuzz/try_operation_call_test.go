package vibelangfuzz

import (
	"strings"
	"testing"
)

// An import is no evidence that an operation's elements are constructed
// eagerly. Keep an actual lazy-element mutant next to every accepted spelling.
func TestTryOperationCall(t *testing.T) {
	for _, name := range []string{"$tryAll", "$tryRace", "$tryAny", "$tryAllSettled"} {
		for _, lazy := range []bool{false, true} {
			element := "a(1)"
			if lazy {
				element = "FX.suspend(() => a(1))"
			}
			call := name + "([" + element + ", a(2)])"
			js := "import { " + name + " } from \"vibelang-runtime\";\n" +
				"function f() { return FX.suspend(() => FX.gen(function* () { return yield* " + call + "; })); }"
			t.Run(name+"/"+element, func(t *testing.T) {
				got := tryOperationCall(js)
				if got != call || strings.Contains(got, "suspend(") != lazy {
					t.Fatalf("must inspect the operation call, including lazy elements: got %q; want %q", got, call)
				}
			})
		}
	}
	for _, lazy := range []bool{false, true} {
		element := "a(1)"
		if lazy {
			element = "FX.suspend(() => a(1))"
		}
		call := "FX.all([FX.exit(" + element + "), FX.exit(a(2))], { concurrency: \"unbounded\" })"
		js := "import { $tryAllSettled } from \"vibelang-runtime\";\n" +
			"import * as FX from \"effect/Effect\";\n" +
			"function* f() { return yield* " + call + "; }"
		t.Run("direct/"+element, func(t *testing.T) {
			got := tryOperationCall(js)
			if got != call || strings.Contains(got, "suspend(") != lazy {
				t.Fatalf("must inspect the direct operation call, including lazy elements: got %q; want %q", got, call)
			}
		})
	}
	// Tail lowering may separate operation construction from delegation.
	for key, js := range map[string]string{
		"held-helper": "const e = $tryAll([a(1)]);",
		"tail-helper": "function f() { return [true, $tryAll([a(1)])]; }",
		"tail-direct": "import * as FX from \"effect/Effect\"; function f() { return [true, FX.all([a(1)])]; }",
	} {
		t.Run(key, func(t *testing.T) {
			want := "$tryAll([a(1)])"
			if key == "tail-direct" {
				want = "FX.all([a(1)])"
			}
			if got := tryOperationCall(js); got != want {
				t.Fatalf("tail transport must keep the actual operation call: got %q; want %q", got, want)
			}
		})
	}
	for key, js := range map[string]string{
		"import-only":      "import { $tryAll } from \"vibelang-runtime\";",
		"unrelated-all":    "function* f() { yield* other.all([a(1)]); }",
		"unrelated-import": "import * as FX from \"other\"; function* f() { yield* FX.all([a(1)]); }",
		"invalid-emission": "function* f() { yield* $tryAll([); }",
	} {
		t.Run(key, func(t *testing.T) {
			if got := tryOperationCall(js); got != "" {
				t.Fatalf("no admitted operation call, got %q", got)
			}
		})
	}
}
