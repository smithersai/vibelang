package vibelangfuzz

import "fmt"

// The pinned MatchProperty early error excludes computed names and bindings.
// Chapter 004 retains that restriction after reconciling identifier keys.
func dataMatchProtoRules() []dataRule {
	const quote = "the separate `__proto__` pattern-key restriction"
	var rules []dataRule
	for i, key := range []string{"__proto__", `"__proto__"`, "'__proto__'", `__pr\u006fto__`, `"__pr\u006fto__"`} {
		for j, suffix := range []string{"", ": let value"} {
			pattern := "{" + key + suffix + "}"
			for k, source := range []string{
				"function f(x:unknown){return match(x){when " + pattern + ":1;default:0;}}",
				"function f(x:unknown){return x is " + pattern + "}",
				"function f(x:unknown){return match(x){when {child:" + pattern + "}:1;default:0;}}",
				"effect function f(x:unknown){return match(x){when " + pattern + ":1;default:0;}}",
			} {
				rules = append(rules, dataRule{fmt.Sprintf("proto-property-rejected-%d-%d-%d", i, j, k), "004-match.md", quote, source, "only:EK0707", "impl-hunt-data"})
			}
		}
	}
	for i, pattern := range []string{
		`{["__proto__"]:let value}`, `{['__proto__']:let value}`,
		`{let __proto__}`, `{const __proto__}`, `{__proto_}`, `{"__proto_":let value}`,
	} {
		for j, source := range []string{
			"function f(x:unknown){return match(x){when " + pattern + ":1;default:0;}}",
			"function f(x:unknown){return x is " + pattern + "}",
		} {
			rules = append(rules, dataRule{fmt.Sprintf("proto-property-control-%d-%d", i, j), "004-match.md", quote, source, "", "impl-hunt-data"})
		}
	}
	return rules
}
