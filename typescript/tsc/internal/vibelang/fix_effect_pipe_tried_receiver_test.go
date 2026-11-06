package vibelang

import (
	"strings"
	"testing"
)

const triedReceiverServices = `import { Context, Effect } from "effect"
class Tag extends Context.Service<Tag, { readonly n: number }>()("Tag") {}
class Other extends Context.Service<Other, { readonly s: string }>()("Other") {}
`

// (try f()) has no parentheses in the tree, so an edit starting at the end of
// the receiver used to take the closing parenthesis with it.
func TestEffectPipeKeepsTheParenthesesOfATriedReceiver(t *testing.T) {
	nested := "import { Effect } from \"effect\"\nconst nested = () => Effect.succeed(Effect.succeed(1))\n"
	for name, test := range map[string]struct{ body, want string }{
		"one line":   {"(try nested()).pipe(Effect.map((n) => n + 1))", "(try nested()) |> Effect.map(%, (n) => n + 1)"},
		"next line":  {"(try nested())\n    .pipe(Effect.map((n) => n + 1))", "(try nested())"},
		"comment":    {"(try nested() /* inner */).pipe(Effect.map((n) => n + 1))", "(try nested() /* inner */) |> Effect.map(%, (n) => n + 1)"},
		"two stages": {"(try nested()).pipe(Effect.map((n) => n + 1), Effect.map((n) => n * 2))", "(try nested()) |> Effect.map(%, (n) => n + 1) |> Effect.map(%, (n) => n * 2)"},
	} {
		t.Run(name, func(t *testing.T) {
			source := nested + "export const result = effect {\n  const inner = " + test.body + "\n  return try inner\n}\n"
			got, result := fixedPipe(t, source)
			if result.Err != nil || strings.Contains(got, ".pipe(") || !strings.Contains(got, test.want) {
				t.Fatalf("%v %+v\n%s", result.Err, result.Refused, got)
			}
			wantNoPipeRefusal(t, result, got)
			again, _ := fixedPipe(t, got)
			if again != got {
				t.Fatalf("not idempotent:\n%s\n%s", got, again)
			}
		})
	}
}

// A tried receiver is the Effect's success value. A value's own pipe means what
// the source says, and the fix has nothing to rewrite.
func TestEffectPipeLeavesTheSuccessValueOfATry(t *testing.T) {
	line := "(try Effect.context<Tag | Other>()).pipe(Context.omit(Other))"
	source := triedReceiverServices + "export const result = effect {\n  const services = " + line + "\n  return services\n}\n"
	got, result := fixedPipe(t, source)
	if result.Err != nil || !strings.Contains(got, line) {
		t.Fatalf("%v %+v\n%s", result.Err, result.Refused, got)
	}
	wantNoPipeRefusal(t, result, got)
}

func wantNoPipeRefusal(t *testing.T, result *FixResult, got string) {
	t.Helper()
	for _, site := range result.Sites {
		if site.Code == "EK4502" {
			t.Fatalf("refused: %+v\n%s", site, got)
		}
	}
}
