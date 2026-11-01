package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// The oracle compares the formatter with itself on two inputs the grammar
// says parse alike: try, fork and join take their operand where ECMAScript
// has AwaitExpression, so a .vibe file formats a prefix as it formats await
// in the same place, with the same parentheses.
var formatPrefixQuotes = []struct{ chapter, quote string }{
	{"900-appendices.md", `TryExpression = [+Effect] "try" UnaryExpression   (where ECMAScript has AwaitExpression)`},
	{"900-appendices.md", `ForkOperand = UnaryExpression   (await's operand, as for try; VIP-17, amended: "exactly as await")`},
	{"007-tooling.md", "It takes the repository's quote style and print width from that formatter's configuration, so `.vibe` and `.ts` files share them."},
}

func requireFormatPrefixQuotes(t testing.TB) {
	t.Helper()
	for _, rule := range formatPrefixQuotes {
		text, err := os.ReadFile(SpecPath(rule.chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), rule.quote) {
			t.Fatalf("%s no longer contains %q", rule.chapter, rule.quote)
		}
	}
}

func TestFormatPrefixOperandsQuoted(t *testing.T) { requireFormatPrefixQuotes(t) }

// formatPrefixOperators are what follows a prefix's operand, keyed so a saved
// corpus file keeps testing the same operator when the list changes.
var formatPrefixOperators = []struct{ key, text string }{
	{"is-class", "is Exit.Failure"},
	{"is-object", `is { _tag: "Left" }`},
	{"instanceof", "instanceof Error"},
	{"in", "in table"},
	{"relational", ">= limit"},
	{"equality", "=== expected"},
	{"additive", "+ 1"},
	{"coalesce", "?? fallback"},
	{"and", "&& ready"},
	{"as", "as number"},
}

var formatPrefixOperands = []string{"x", "x.value", "load(x)", "exit(CommandLine.lex(command))", "x[0]", "(x)"}

var formatPrefixPlaces = []string{"const a = %s", "expect(%s).toBe(true)", "if (%s) use(x)", "return %s", "const b = [%s, x]"}

// FuzzFormatPrefixOperands formats try, fork and join operands of each
// operator, bare and parenthesized, in several places, and compares each
// result with the same file written with await (smithers Command.test.vibe:
// (try exit(...)) is Exit.Failure).
func FuzzFormatPrefixOperands(f *testing.F) {
	startShortBudget(f)
	requireFormatPrefixQuotes(f)
	for _, prefix := range []string{"try", "fork", "join"} {
		for _, operator := range formatPrefixOperators {
			f.Add(prefix, operator.key, uint8(0))
			f.Add(prefix, operator.key, uint8(0x2d))
		}
	}
	formatter := toolsFormatter(f)
	f.Fuzz(func(t *testing.T, prefix, key string, mode uint8) {
		if prefix != "try" && prefix != "fork" && prefix != "join" {
			prefix = []string{"try", "fork", "join"}[len(prefix)%3]
		}
		operator := formatPrefixOperators[int(mode)%len(formatPrefixOperators)]
		for _, candidate := range formatPrefixOperators {
			if candidate.key == key {
				operator = candidate
			}
		}
		operand := formatPrefixOperands[int(mode>>1)%len(formatPrefixOperands)]
		place := formatPrefixPlaces[int(mode>>3)%len(formatPrefixPlaces)]
		wrap := mode&0x40 != 0
		write := func(word, function string) string {
			expression := word + " " + operand
			if wrap {
				expression = "(" + expression + ")"
			}
			body := fmt.Sprintf(place, expression+" "+operator.text)
			return fmt.Sprintf("%s function f(x: any, command: any) {\n  %s\n}\n", function, body)
		}
		source, twin := write(prefix, "effect"), write("await", "async")
		if err := toolsSyntaxError("main.vibe", source); err != "" {
			t.Fatalf("invalid generator: %s\n%s", err, source)
		}
		once, err := vibelangfmt.Format("main.vibe", source, formatter)
		if err != nil {
			Gap(t, "FuzzFormatPrefixOperands", "refusal:"+prefix+":"+operator.key, "the formatter refused a valid prefix operand: %v\n%s", err, source)
			return
		}
		twinOnce, err := vibelangfmt.Format("main.vibe", twin, formatter)
		if err != nil {
			Gap(t, "FuzzFormatPrefixOperands", "refusal:await:"+operator.key, "the formatter refused the await twin: %v\n%s", err, twin)
			return
		}
		// The await twin, written back with the prefix: async function becomes
		// effect function and the one await the prefix.
		want := strings.Replace(strings.Replace(twinOnce, "async function", "effect function", 1), "await", prefix, 1)
		if once != want {
			Gap(t, "FuzzFormatPrefixOperands", "await-twin:"+prefix+":"+operator.key, "%s formats unlike await in the same place:\n%s\nformatted:\n%s\nawait formats as:\n%s", prefix, source, once, twinOnce)
		}
		twice, err := vibelangfmt.Format("main.vibe", once, formatter)
		if err != nil || twice != once {
			Gap(t, "FuzzFormatPrefixOperands", "idempotence:"+prefix+":"+operator.key, "%v\n%s\n%s", err, once, twice)
		}
	})
}
