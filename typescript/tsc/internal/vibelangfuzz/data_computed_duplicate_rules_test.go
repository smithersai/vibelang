package vibelangfuzz

import "fmt"

// Static acceptance and diagnostics come from the data chapter's TypeScript
// duplicate-member rule. Runtime payload construction is checked separately.
func dataComputedDuplicateRules() []dataRule {
	const compatible = "Computed members with the same resolved name can merge when TypeScript admits them."
	const incompatible = "incompatible computed declarations instead receive the native \x60TS2717\x60 check."
	const ordinary = "Duplicate variant and field declarations receive the native TypeScript checks for their type members, rather than an unconditional duplicate-identifier diagnostic."
	var rules []dataRule
	for _, key := range []struct{ name, decl, first, second string }{
		{"alias-literal", "const key='x' as const;", "[key]", "['x']"},
		{"qualified-literal", "const keys={name:'x'} as const;", "[keys.name]", "['x']"},
		{"alias-alias", "const key='x' as const;", "[key]", "[key]"},
		{"literal-literal", "", "['x']", "['x']"},
		{"numeric-alias", "const key=1 as const;", "[key]", "[1]"},
		{"negative-number", "", "[-1]", "[-1]"},
		{"unique-symbol", "const key:unique symbol=Symbol();", "[key]", "[key]"},
		{"computed-plain", "const key='x' as const;", "[key]", "x"},
	} {
		for _, conflict := range []bool{false, true} {
			typ, code, quote, suffix := "number", "", compatible, "compatible"
			if conflict {
				typ, code, quote, suffix = "string", "only:TS2717", incompatible, "incompatible"
			}
			rules = append(rules, dataRule{
				"computed-duplicate-" + key.name + "-" + suffix, "006-data.md", quote,
				fmt.Sprintf("%s data Shape { Row { %s:number; %s:%s } }", key.decl, key.first, key.second, typ),
				code, "compiler",
			})
		}
	}
	for _, control := range []struct{ name, source string }{
		{"plain-control", "data Shape { Row { x:number; x:number } }"},
		{"mixed-control", "const key='x' as const; data Shape { Row { x:number; [key]:number; x:number } }"},
	} {
		rules = append(rules, dataRule{"computed-duplicate-" + control.name, "006-data.md", ordinary, control.source, "only:TS2300,TS2300", "compiler"})
	}
	return rules
}
