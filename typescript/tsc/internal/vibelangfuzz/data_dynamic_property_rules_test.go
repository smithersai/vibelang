package vibelangfuzz

import "fmt"

// Chapter 004 types an extracted property of an unknown subject as unknown.
func dataDynamicPropertyRules() []dataRule {
	const quote = "An extracted property of an `unknown` subject is `unknown`"
	var rules []dataRule
	for i, tc := range []struct{ decl, key string }{
		{"declare const key:string;", "key"},
		{"declare const key:number;", "key"},
		{"declare const key:symbol;", "key"},
		{"declare const key:string|number;", "key"},
		{"declare const key:'a'|'b';", "key"},
		{"const names={field:'field'};", "names.field"},
		{"const names={get field():string{return 'field'}};", "names.field"},
		{"type Key=string&{readonly brand:unique symbol};declare const key:Key;", "key"},
		{"declare const key:string|symbol;", "key"},
		{"declare const key:PropertyKey;", "key"},
	} {
		for j, unsafe := range []bool{false, true} {
			arm := "value"
			success := "return value;"
			code := ""
			if unsafe {
				arm = "do{const n:number=value;n}"
				success = "const n:number=value;return n;"
				code = "only:TS2322"
			}
			for k, source := range []string{
				"function f(x:unknown){return match(x){when {[" + tc.key + "]:let value}:" + arm + ";default:0;}}",
				"function f(x:unknown){if(x is {[" + tc.key + "]:let value}){" + success + "}return 0}",
				"function f(x:unknown){return match(x){when {child:{[" + tc.key + "]:let value}}:" + arm + ";default:0;}}",
				"effect function f(x:unknown){return match(x){when {[" + tc.key + "]:let value}:" + arm + ";default:0;}}",
			} {
				rules = append(rules, dataRule{fmt.Sprintf("dynamic-property-unknown-%d-%d-%d", i, j, k), "004-match.md", quote, tc.decl + source, code, "impl-hunt-data"})
			}
		}
	}
	return rules
}
