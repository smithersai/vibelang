package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const forkOperandDiagnosticsTarget = "FuzzForkOperandDiagnostics"
const forkOperandDiagnosticsQuote = "`fork (e catch h)` runs `e` here and forks its result: `EK1703` unless the result is an Effect."
const forkOperandNativeQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."

func TestForkOperandDiagnosticsQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"002-running.md": forkOperandDiagnosticsQuote,
		"007-tooling.md": forkOperandNativeQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// VIP-17 supplies the rejected domain; VIP-34 assigns its diagnostic and
// preserves independent native errors. Mutate wrappers and nested calls so
// coalescing the generated call cannot hide a written call's argument error.
func FuzzForkOperandDiagnostics(f *testing.F) {
	startShortBudget(f)
	rules := []struct {
		key, operand string
		native       string
		accepted     bool
	}{
		{"catch-value", "Effect.fail(\"bad\") catch () => 7", "", false},
		{"number", "7", "", false},
		{"string", "\"bad\"", "", false},
		{"boolean", "true", "", false},
		{"null", "null", "", false},
		{"undefined", "undefined", "", false},
		{"bigint", "7n", "", false},
		{"array", "[7]", "", false},
		{"object", "{ value: 7 }", "", false},
		{"options-object", "{ uninterruptible: true }", "", false},
		{"options-invalid", "{ uninterruptible: \"wrong\" }", "", false},
		{"class", "class Task {}", "", false},
		{"regexp", "/bad/", "", false},
		{"object-inner-call", "{ value: value(0) }", "TS2345", false},
		{"object-inner-excess", "{ value: options({ extra: 0 }) }", "TS2353", false},
		{"object-inner-assignment", "{ uninterruptible: (text = 7) }", "TS2322", false},
		{"object-inner-satisfies", "{ value: (7 satisfies string) }", "TS1360", false},
		{"object-satisfies-excess", "({ value: 7 } satisfies { ok: number })", "TS2353", false},
		{"arrow", "() => 7", "", false},
		{"named-function", "function task() { return 7 }", "", false},
		{"inner-call", "value(0)", "TS2345", false},
		{"effect", "Effect.succeed(7)", "", true},
		{"catch-effect", "Effect.fail(\"bad\") catch () => Effect.succeed(7)", "", true},
		{"catch-inner-call", "Effect.fail(\"bad\") catch () => value(0)", "TS2345", false},
	}
	for _, rule := range rules {
		for wrapper := uint8(0); wrapper < 4; wrapper++ {
			f.Add(rule.key, wrapper)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestForkOperandDiagnosticsQuoted(t)
		i := slices.IndexFunc(rules, func(rule struct {
			key, operand string
			native       string
			accepted     bool
		}) bool {
			return rule.key == key
		})
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		rule := rules[i]
		operand := "(" + rule.operand + ")"
		switch variant % 4 {
		case 1:
			operand = "((/* operand */ " + operand + "))"
		case 2:
			operand = "(" + operand + " satisfies unknown)"
		case 3:
			operand = "(\n" + operand + "\n)"
		}
		source := "import { Effect } from \"effect\";\nimport { value, options } from \"./native.js\";\nlet text = \"\";\nexport effect function main() { const child = fork " + operand + "; return 0 }"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "native.ts": "/** @throws {never} */\nexport declare function value(input: string): number;\n/** @throws {never} */\nexport declare function options(input: { ok: number }): number;\n"}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var got []string
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				code := diagnosticCodeName(d.Source(), d.Code())
				if d.Source() == "" {
					code = "TS" + code
				}
				got = append(got, code)
				// A written satisfies check can fail at the exact same key
				// and with the same code as the generated helper's check.
				if code == "TS2353" && rule.native == code && !strings.Contains(d.String(), "ok:") {
					Gap(t, forkOperandDiagnosticsTarget, fmt.Sprintf("%s:%d", rule.key, variant%4), "lost the written object's target type: %s", d.String())
				}
				if code == "TS2322" && rule.key == "object-inner-assignment" && !strings.Contains(d.String(), "type 'string'") {
					Gap(t, forkOperandDiagnosticsTarget, fmt.Sprintf("%s:%d", rule.key, variant%4), "lost the written assignment's string target: %s", d.String())
				}
			}
		}
		var want []string
		if !rule.accepted {
			want = append(want, "EK1703")
		}
		if rule.native != "" {
			want = append(want, rule.native)
		}
		slices.Sort(got)
		if !slices.Equal(got, want) {
			Gap(t, forkOperandDiagnosticsTarget, fmt.Sprintf("%s:%d", rule.key, variant%4), "VIP-17/VIP-34 want %v, got %v\n%s", want, got, source)
		}
		ExpectPending(t, forkOperandDiagnosticsTarget, fmt.Sprintf("%s:%d", rule.key, variant%4))
	})
}
