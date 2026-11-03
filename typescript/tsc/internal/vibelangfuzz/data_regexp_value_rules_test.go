package vibelangfuzz

// Chapter 004 reconciles regex literals and stored RegExp values explicitly.
func dataRegExpValueRules() []dataRule {
	const quote = "regex patterns accept both literals and `RegExp` values"
	var rules []dataRule
	for _, input := range []struct{ key, prefix, parameters, matcher string }{
		{"literal", "const r=/a/;", "x:unknown", "r"},
		{"constructor", `const r=new RegExp("a");`, "x:unknown", "r"},
		{"parameter", "", "x:unknown,r:RegExp", "r"},
		{"property", "", "x:unknown,b:{r:RegExp}", "b.r"},
		{"alias", "type R=RegExp;", "x:unknown,r:R", "r"},
		{"subclass", `class R extends RegExp{} const r=new R("a");`, "x:unknown", "r"},
	} {
		for _, context := range []string{"is", "bare", "extractor"} {
			expr := "x is " + input.matcher
			if context == "bare" {
				expr = "match(x){when " + input.matcher + `:1;default:0;}`
			}
			if context == "extractor" {
				expr = "match(x){when " + input.matcher + `(let m):m[0];default:"none";}`
			}
			source := input.prefix + "export function f(" + input.parameters + "){return " + expr + ";}"
			rules = append(rules, dataRule{"match-regexp-value-" + input.key + "-" + context, "004-match.md", quote, source, "", "impl-hunt-data"})
		}
	}
	for _, input := range []struct{ key, prefix, parameters string }{
		{"object", "const r={test(){return true}};", "x:unknown"},
		{"any", "", "x:unknown,r:any"},
		{"unknown", "", "x:unknown,r:unknown"},
	} {
		for _, extractor := range []bool{false, true} {
			expr := "x is r"
			key := "is"
			if extractor {
				expr = `match(x){when r(let m):m;default:0;}`
				key = "extractor"
			}
			rules = append(rules, dataRule{"match-regexp-value-control-" + input.key + "-" + key, "004-match.md", quote, input.prefix + "export function f(" + input.parameters + "){return " + expr + ";}", "only:EK0702", "impl-hunt-data"})
		}
	}
	return rules
}
