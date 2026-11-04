package vibelangfuzz

import "fmt"

// Chapter 004: static admission of the complete synchronous iterator protocol.
// Runtime matcher behaviour remains in FuzzVIPDifferential.
func dataExtractorReturnRules() []dataRule {
	const quote = "an extractor requires `Iterable<unknown> | false`."
	var rules []dataRule
	for _, tc := range []struct {
		name, result, parameters string
		invalid                  bool
	}{
		{"iterator-data", "{ [Symbol.iterator]: 1 }", "", true},
		{"iterator-optional", "{ [Symbol.iterator]?: () => Iterator<number> }", "", true},
		{"iterator-needs-argument", "{ [Symbol.iterator](n: number): Iterator<number> }", "", true},
		{"iterator-primitive", "{ [Symbol.iterator](): number }", "", true},
		{"next-data", "{ [Symbol.iterator](): { next: number } }", "", true},
		{"next-primitive", "{ [Symbol.iterator](): { next(): number } }", "", true},
		{"result-no-value", "{ [Symbol.iterator](): { next(): { done: false } } }", "", true},
		{"async-only", "AsyncIterable<number>", "", true},
		{"unknown", "unknown", "", true},
		{"true", "true", "", true},
		{"never", "never", "", false},
		{"false", "false", "", false},
		{"any", "any", "", false},
		{"array", "number[]", "", false},
		{"readonly-tuple", "readonly [number, string]", "", false},
		{"string", "string", "", false},
		{"set", "Set<number>", "", false},
		{"generator", "Generator<number, string, unknown>", "", false},
		{"iterable", "Iterable<number>", "", false},
		{"structural", "{ [Symbol.iterator](): { next(): { done: false; value: number } } }", "", false},
		{"branded-false", "false & { readonly marker: unique symbol }", "", false},
		{"branded-union", "(Iterable<unknown> | false) & { readonly marker: unique symbol }", "", false},
		{"generic-union", "T", "<T extends Iterable<unknown> | false>", false},
		{"generic-false", "T", "<T extends false>", false},
		{"generic-iterable", "T", "<T extends Iterable<unknown>>", false},
		{"generic-open", "T", "<T>", true},
	} {
		for i, suffix := range []string{"", " | false"} {
			code := ""
			if tc.invalid {
				code = "only:EK0702"
			}
			name := fmt.Sprintf("extractor-return-%s-%d", tc.name, i)
			source := "declare function matcher" + tc.parameters + "(s: unknown): " + tc.result + suffix + ";\nfunction f(s: unknown) { return match(s) { when matcher(let value): value; default: 0; } }"
			rules = append(rules, dataRule{name, "004-match.md", quote, source, code, "impl-hunt-data"})
		}
	}
	return rules
}
