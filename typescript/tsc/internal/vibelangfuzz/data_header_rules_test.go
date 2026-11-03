package vibelangfuzz

import "fmt"

// VIP-16: recognition is independent of the token following BindingIdentifier.
// Existing FuzzDataSpecRules supplies keyed corpus selection and trivia mutation.
func dataHeaderRules() []dataRule {
	var rules []dataRule
	add := func(key, quote, source, code string) {
		rules = append(rules, dataRule{"data-header-" + key, "006-data.md", quote, source, code, "conf-auto-data-header-contextual-name"})
	}
	const required = "a recognized data header missing its variant body is " + "\x60EK1604\x60"
	const contextual = "the keyword and the name on one line, where a declaration can start"
	for _, name := range []string{"D", "as", "satisfies", "is", "type", "$D", "D\\u0061ta"} {
		for ei, ending := range []string{"", ";", "\nconst after=1;"} {
			for ci, context := range []string{"%s", "namespace N {%s\n}", "function f(){%s\n}"} {
				key := fmt.Sprintf("missing-%s-%d-%d", name, ei, ci)
				add(key, required, fmt.Sprintf(context, "data /* keep */ "+name+ending), "EK1604")
			}
		}
	}
	for _, op := range []string{"as", "satisfies", "is"} {
		for _, gap := range []string{" ", " /* keep */ "} {
			prefix := "const data=1; type T=number; "
			key := fmt.Sprintf("%s-%d", op, len(gap))
			operand := " T"
			if op == "is" {
				operand = " Number"
			}
			add("assertion-"+key, required, prefix+"data"+gap+op+operand+";", "EK1604")
			add("parenthesized-"+key, contextual, prefix+"(data"+gap+op+operand+");", "")
			add("initializer-"+key, contextual, prefix+"const result=data"+gap+op+operand+";", "")
			add("return-"+key, contextual, prefix+"function f(){return data"+gap+op+operand+"}", "")
		}
	}
	for _, name := range []string{"as", "satisfies", "is", "type"} {
		add("body-"+name, contextual, "data "+name+"\n{ V }; const result:"+name+"="+name+".V()", "")
	}
	return rules
}
