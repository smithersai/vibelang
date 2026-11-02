package vibelangfuzz

import (
	"fmt"
	"strings"
)

func dataDollarBindingRules() []dataRule {
	var rules []dataRule
	for i, name := range []string{"$id", "$$id", "$match1", "$is1", "$extracted2", `$\u0069d`} {
		for _, binding := range []string{"let", "const"} {
			source := fmt.Sprintf("export function f(x:unknown):unknown { if (x is {id:%s %s}) return %s; return 0 }", binding, name, strings.ReplaceAll(name, `\u0069`, "i"))
			rules = append(rules, dataRule{
				fmt.Sprintf("is-dollar-name-%d-%s", i, binding), "004-match.md",
				"Pattern bindings use `let` or `const`",
				source, "", "impl-hunt-data",
			})
		}
	}
	return rules
}
