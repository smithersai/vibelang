package vibelangfuzz

import "fmt"

func dataNestedIsRules() []dataRule {
	var rules []dataRule
	for _, shape := range []struct{ name, pattern string }{
		{"array", "{ items: [let value] }"},
		{"object", "{ child: { let value } }"},
		{"deep", "{ child: { items: [let value] } }"},
	} {
		for _, collide := range []bool{false, true} {
			prefix := ""
			suffix := ""
			if collide {
				prefix = "const $match1=1,$match2=2,$match3=3,$is1=4; void [$match1,$match2,$match3,$is1]; "
				suffix = "-collision"
			}
			source := "export function f(): unknown { " + prefix + "if (({ items:[7], child:{value:7,items:[7]} }) is " + shape.pattern + ") return value; return 0 }"
			rules = append(rules, dataRule{
				fmt.Sprintf("nested-is-%s%s", shape.name, suffix), "004-match.md",
				"`x is P` has type `boolean` and narrows `x` as a type predicate where `P` narrows.",
				source, "", "impl-hunt-data",
			})
		}
	}
	return rules
}
