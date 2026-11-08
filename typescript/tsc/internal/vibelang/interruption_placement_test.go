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

// Decorator expressions execute where the class is defined. Member bodies
// and nested written callables still keep their own activation.
func TestInterruptionDecoratorContext(t *testing.T) {
	heads := []string{
		"% class C {}",
		"class C { % method() {} }",
		"class C { % field = 1 }",
		"class C { % get value() { return 1 } }",
		"class C { % set value(value: number) {} }",
		"class C { % static method() {} }",
		"class C { % static field = 1 }",
	}
	for _, head := range heads {
		for _, word := range []string{"uninterruptible", "interruptible", "restore"} {
			decorated := strings.ReplaceAll(head, "%", "@(do { "+word+" {}; ((value: unknown, context: unknown) => {}) })")
			for _, context := range []struct {
				prefix, suffix string
				want           int32
			}{
				{"effect function f(){ uninterruptible {", "} }", 0},
				{"function f(){", "}", 2201},
			} {
				source := context.prefix + decorated + context.suffix
				t.Run(source, func(t *testing.T) {
					errors := errorsOf(t, source)
					if context.want == 0 && len(errors) != 0 || context.want != 0 && (len(errors) != 1 || errors[0].Code() != context.want) {
						t.Fatalf("want %d, got %v", context.want, errors)
					}
				})
			}
		}
	}
	for _, body := range []struct {
		source string
		want   int32
	}{
		{"class C { @(do { const later = effect { restore {} }; ((value: unknown, context: unknown) => {}) }) m(){} }", 2202},
		{"class C { @(do { const later = () => { restore {} }; ((value: unknown, context: unknown) => {}) }) m(){} }", 2201},
		{"for concurrent(const x of [1]){ class C { @(do { restore {}; ((value: unknown, context: unknown) => {}) }) m(){} } }", 2202},
		{"class C { @(do { uninterruptible { restore {} }; ((value: unknown, context: unknown) => {}) }) m(){} }", 0},
	} {
		source := "effect function f(){uninterruptible {" + body.source + "}}"
		t.Run(source, func(t *testing.T) {
			errors := errorsOf(t, source)
			if body.want == 0 && len(errors) != 0 || body.want != 0 && (len(errors) != 1 || errors[0].Code() != body.want) {
				t.Fatalf("want %d, got %v", body.want, errors)
			}
		})
	}
}
