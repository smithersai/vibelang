package vibelangfuzz

import (
	"strings"
	"testing"
)

const trustedPredicateTarget = "FuzzTrustedPredicateInput"
const trustedPredicateOwnQuote = "A destination typed by the source's own signature carries the source's thrown type, so it admits it:"
const trustedPredicateRetiredQuote = "`EK0407` retires the resolved `trusted(f, [])` wrapper."

func TestTrustedPredicateInputQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"003-failures.md": trustedPredicateOwnQuote,
		"007-tooling.md":  trustedPredicateRetiredQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// The retirement diagnostic does not invent an incompatible callback contract.
// Compare predicates' inferred declaration types with their TypeScript twins;
// execution of emitted legacy programs stays in the compiler acceptance case.
func FuzzTrustedPredicateInput(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"alchemy-gcp-trusted-predicate", "generic", "method", "throws", "assertion"} {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, raw uint8) {
		TestTrustedPredicateInputQuoted(t)
		impl, annotation := "isNumber", ""
		foreign := "export function isNumber(value: unknown): value is number { return typeof value === \"number\" }\n"
		switch key {
		case "generic":
			foreign = "export function isNumber<T>(value: unknown, sample: T): value is T { return typeof value === typeof sample }\n"
			impl = "isNumber<number>"
		case "method":
			foreign = "export const isNumber = { check(value: unknown): value is number { return typeof value === \"number\" } }\n"
			impl = "isNumber.check"
		case "throws":
			foreign = "/** @throws {TypeError} */\nexport function isNumber(value: unknown): value is number { if (value === null) throw new TypeError(\"null\"); return typeof value === \"number\" }\n"
		case "assertion":
			foreign = "export function isNumber<T>(value: unknown, sample: T): asserts value is T { if (typeof value !== typeof sample) throw new TypeError(\"number required\") }\n"
			impl = "isNumber<number>"
			annotation = ": (value: unknown, sample: number) => asserts value is number"
		default:
			key = "alchemy-gcp-trusted-predicate"
		}
		call := "safe(value)"
		if key == "generic" || key == "assertion" {
			call = "safe(value, 0)"
		}
		body := []string{
			"if (" + call + ") return value + 1; return 0",
			"if (!" + call + ") return 0; return value + 1",
			"if (" + call + " && value > 0) return value + 1; return 0",
			"if (true) if (" + call + ") return value + 1; return 0",
		}[raw%4]
		if key == "assertion" {
			body = call + "; return value + 1"
		}
		prefix := "import * as Effect from \"effect/Effect\"\nimport { trusted } from \"vibelang-runtime\"\nimport { isNumber } from \"./foreign.js\"\nconst safe" + annotation + " = trusted(" + impl + ", [])\n"
		stock := prefix + "export const program = (value: unknown) => Effect.gen(function* () { " + body + " })\n"
		source := prefix + "export const program = effect (value: unknown) => { " + body + " }\n"
		toolsGuard(t, trustedPredicateTarget, func() {
			before := toolsCompile(t, w, trustedPredicateTarget, map[string]string{"main.ts": stock, "foreign.ts": foreign})
			defer before.Remove()
			if len(before.Diagnostics) != 0 {
				t.Fatalf("TypeScript twin: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
			}
			legacy := toolsCompile(t, w, trustedPredicateTarget, map[string]string{"main.vibe": source, "foreign.ts": foreign})
			defer legacy.Remove()
			if len(legacy.Diagnostics) != 1 || legacy.Diagnostics[0].Code() != 407 {
				Gap(t, trustedPredicateTarget, key, "VIP-4's own-signature rule and retirement require EK0407 alone: %v", SortedKeys(Keys(legacy.Dir, legacy.Diagnostics)))
				return
			}
			declaration := before.Outputs["out/main.d.ts"]
			if declaration == "" || legacy.Outputs["out/main.d.ts"] == "" {
				t.Fatal("missing emitted declaration control")
			}
			if declaration != legacy.Outputs["out/main.d.ts"] {
				Gap(t, trustedPredicateTarget, key, "predicate declarations differ from TypeScript:\n%s\n%s", declaration, legacy.Outputs["out/main.d.ts"])
			}
		})
	})
}
