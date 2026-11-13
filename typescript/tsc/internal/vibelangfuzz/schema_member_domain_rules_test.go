package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// VIP-15 gives non-fields in schema declaration bodies EK1505. An alias's
// object type instead keeps the unsupported-type diagnostic EK2109.
// Generate each member in several contexts so lowering cannot lose its owner.
func schemaMemberDomainRules() []dataRule {
	const chapter = "006-data.md"
	const quote = "a member of a `schema` body that is not a [Field](900-appendices.md#field)"
	var rules []dataRule
	for _, member := range []struct{ key, source string }{
		{"method", "m(): string"},
		{"index", "[key: string]: number"},
		{"call", "(n: number): string"},
		{"construct", "new (n: number): object"},
		{"getter", "get n(): number"},
		{"setter", "set n(value: number)"},
		{"untyped", "n"},
	} {
		for _, context := range []struct{ key, template, code string }{
			{"body", "schema S { %s }", "EK1505"},
			{"nested", "schema S { inner: { %s } }", "EK1505"},
			{"readonly-nested", "schema S { readonly inner: { %s } }", "EK1505"},
			{"namespace", "namespace N { export schema S { %s } }", "EK1505"},
			{"alias", "schema S = { %s }", "EK2109"},
			{"alias-nested", "schema S = { inner: { %s } }", "EK2109"},
		} {
			memberQuote := quote
			if strings.HasPrefix(context.key, "alias") {
				memberQuote = "a field type outside the mapping (including a shadowing type without a suitable Schema value)"
			}
			rules = append(rules, dataRule{
				"schema-member-domain-" + context.key + "-" + member.key,
				chapter, memberQuote, fmt.Sprintf(context.template, member.source),
				"only:" + context.code,
			})
		}
	}
	return append(rules, dataRule{
		"schema-member-domain-fields", chapter, "properties are writable unless `readonly`",
		"schema S { n: number; readonly name?: string; inner: { value: number } }; schema T = { n: number }",
		"",
	})
}

// TestSchemaMemberDomainQuoted checks the VIP-15 quotes used by the generated
// member rules. The spec gate selects quote tests by name.
func TestSchemaMemberDomainQuoted(t *testing.T) {
	for _, rule := range schemaMemberDomainRules() {
		chapter := SpecText(rule.chapter)
		if !strings.Contains(chapter, rule.quote) {
			t.Errorf("%s: chapter %s no longer says %q", rule.name, rule.chapter, rule.quote)
		}
		code := strings.TrimPrefix(rule.code, "only:")
		if code != "" && !strings.Contains(chapter, code) {
			t.Errorf("%s: chapter %s no longer specifies %s", rule.name, rule.chapter, code)
		}
	}
}
