package vibelangfuzz

import "strings"

// VIP-15's mapping rule has no file-scope exception. Vary both lexical homes
// and mapped positions so a visitor cannot silently skip local declarations.
func dataScopedSchemaAliasRules() []dataRule {
	const chapter = "../vips/0015-schema-declarations.md"
	const rejectQuote = "A type outside that mapping is a compile error."
	const acceptQuote = "\x60schema Name { fields }\x60 and \x60schema Name = type\x60 declare a Schema constant and its type under one name."
	var rules []dataRule
	for _, scope := range []struct{ key, source string }{
		{"file", "%s"},
		{"block", "{ %s }"},
		{"function", "function build() { %s }"},
		{"arrow", "const build = () => { %s }"},
		{"method", "class Factory { build() { %s } }"},
		{"namespace", "namespace N { %s }"},
		{"nested-namespace", "namespace Outer.Inner { %s }"},
	} {
		for _, typ := range []struct{ key, source string }{
			{"unknown", "unknown"},
			{"any", "any"},
			{"never", "never"},
			{"object", "object"},
			{"void", "void"},
			{"callable", "() => void"},
			{"array", "unknown[]"},
			{"tuple", "readonly [string, void]"},
			{"reference", "NotSchema"},
		} {
			declaration := "const NotSchema = 1; schema Local = " + typ.source + ";"
			rules = append(rules, dataRule{"schema-scoped-alias-" + scope.key + "-" + typ.key, chapter, rejectQuote, strings.Replace(scope.source, "%s", declaration, 1), "only:EK2109", "impl-hunt-data"})
		}
		declaration := "const Codec = Schema.NumberFromString; schema Primitive = string; schema Named = Codec; schema Explicit = Schema.Unknown; schema Nested = { value: number };"
		rules = append(rules, dataRule{"schema-scoped-alias-" + scope.key + "-valid", chapter, acceptQuote, strings.Replace(scope.source, "%s", declaration, 1), "", "impl-hunt-data"})
	}
	return rules
}
