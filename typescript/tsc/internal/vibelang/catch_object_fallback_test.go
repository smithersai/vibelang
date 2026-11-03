package vibelang

import (
	"strings"
	"testing"
)

// VIP-5's plain handler gives its fallback value. An object literal must
// remain an expression after =>; braces alone become a block returning void.
func TestCatchHandlerObjectFallback(t *testing.T) {
	const prefix = "export effect function f() { return Effect.fail(\"x\") catch "
	for _, object := range []string{
		"{}", "{ directory: \"repo\" }", "{ directory: \"repo\", maybeRefusal: Option.some(\"unverified\") }",
		"{ [\"directory\"]: \"repo\" }", "{ ...{ directory: \"repo\" } }", "{ /* preserve fallback */ directory: \"repo\" }",
		"{ directory: \"repo\" } as { directory: string }",
		"{ directory: \"repo\" } satisfies { directory: string }",
		"{ directory: \"repo\" }!",
		"{ directory: \"repo\" }.directory",
	} {
		t.Run(object, func(t *testing.T) {
			source := prefix + object + " }\n"
			want := prefix + "() => (" + object + ") }\n"
			checkCatchHandlerFix(t, source, object, want, true)
			fixed, name := fixVIPOnlySource(t, source)
			if fixed.Err != nil || len(fixed.Refused) != 0 {
				t.Fatalf("migration refused: %+v", fixed)
			}
			got := source
			if f := fixed.Files[name]; f != nil {
				got = f.Text
			}
			if got != want {
				t.Fatalf("migrated\n%s\nwant\n%s", got, want)
			}
			if !strings.Contains(got, "() => (") {
				t.Fatal("object fallback became a block")
			}
		})
	}
}

func TestCatchHandlerObjectFallbackUnderLegacyTry(t *testing.T) {
	source := `export effect function main() { return try (Effect.fail("bad") catch { v: 3 }) }`
	fixed, name := fixVIPOnlySource(t, source)
	if fixed.Err != nil || len(fixed.Refused) != 0 {
		t.Fatalf("migration refused: %+v", fixed)
	}
	got := source
	if file := fixed.Files[name]; file != nil {
		got = file.Text
	}
	if strings.Contains(got, "return try") || !strings.Contains(got, "() => ({ v: 3 })") {
		t.Fatalf("wrong repair: %s", got)
	}
}
