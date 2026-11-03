package vibelang

import (
	"strings"
	"testing"
)

// VIP-22: outside effect code EK2201 takes priority over restore nesting.
func TestInterruptionPlacement(t *testing.T) {
	for _, word := range []string{"uninterruptible", "interruptible", "restore"} {
		for _, source := range []string{
			"function f() { % { } }",
			"async function f() { % { } }",
			"effect function f() { const g = () => { % { } } }",
			"effect function f() { uninterruptible { const g = () => { % { } } } }",
			"effect function f() { class C { value = do { % { }; 1 } } }",
			"effect function f() { class C { static { % { } } } }",
			"effect function f(n = do { % { }; 1 }) {}",
			"% { }",
		} {
			source = strings.ReplaceAll(source, "%", word)
			t.Run(source, func(t *testing.T) {
				errors := errorsOf(t, source)
				if len(errors) != 1 || errors[0].Code() != 2201 {
					t.Fatalf("want only EK2201, got %v", errors)
				}
			})
		}
	}
}

func TestInterruptionPlacementFix(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"function f() { uninterruptible { return 1 } }", "function f() {  { return 1 } }"},
		{"async function f() { interruptible /* comment */ { return 1 } }", "async function f() {  /* comment */ { return 1 } }"},
		{"const f = () => { uninterruptible { restore { return 1 } } }", "const f = () => {  {  { return 1 } } }"},
		{"effect function f() { uninterruptible { const g = () => { interruptible { return 1 } }; return 2 } }", "effect function f() { uninterruptible { const g = () => {  { return 1 } }; return 2 } }"},
	} {
		t.Run(test.source, func(t *testing.T) {
			got, result := fixedPipe(t, test.source)
			if got != test.want {
				t.Fatalf("--fix wrote %q; want %q; refused %+v", got, test.want, result.Refused)
			}
			if errors := errorsOf(t, got); len(errors) != 0 {
				t.Fatalf("fixed source: %v", errors)
			}
			if again, _ := fixedPipe(t, got); again != got {
				t.Fatalf("not idempotent: %q", again)
			}
		})
	}
}

// VIP-22: the parser stores concurrent head initialization in a generated
// arrow parameter. Its source runs in the item Effect; restore retains EK2202.
func TestInterruptionPlacementConcurrentHead(t *testing.T) {
	for _, word := range []string{"uninterruptible", "interruptible", "restore"} {
		source := "effect function f() { for concurrent (const { n = do { " + word + " { }; 1 } } of [{ n: 1 }]) { n } }"
		errors := errorsOf(t, source)
		if word == "restore" {
			if len(errors) != 1 || errors[0].Code() != 2202 {
				t.Fatalf("%s: want EK2202, got %v", word, errors)
			}
		} else if len(errors) != 0 {
			t.Fatalf("%s: want no error, got %v", word, errors)
		}
	}
}
