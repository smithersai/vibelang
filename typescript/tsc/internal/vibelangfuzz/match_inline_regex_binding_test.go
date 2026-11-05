package vibelangfuzz

import (
	"fmt"
	"strings"
)

// Static controls retain each native array type and reject any/unknown bindings.
func inlineRegexBindingHomePatterns() []bindingHomePattern {
	var patterns []bindingHomePattern
	for _, binding := range []string{"let", "const"} {
		for _, pair := range []struct{ key, left, right, result string }{
			{"global-global", "/(a)/g", "/(b)/g", "RegExpExecArray"},
			{"global-nonglobal", "/(a)/g", "/(b)/", "RegExpMatchArray"},
			{"nonglobal-global", "/(a)/", "/(b)/g", "RegExpMatchArray"},
			{"nonglobal-nonglobal", "/(a)/", "/(b)/", "RegExpMatchArray"},
		} {
			checked := inlineRegexCheckedValue(pair.result == "RegExpExecArray")
			native := "(() => { const value = " + inlineRegexNativeAttempt(pair.left) + " ?? " + inlineRegexNativeAttempt(pair.right) + "; if(value===undefined)return fallback; return " + checked + "; })()"
			patterns = append(patterns, bindingHomePattern{
				name: "regex-inline-or-" + pair.key + "-" + binding, subject: "string", result: pair.result,
				arm: fmt.Sprintf("when %s(%s value) or %s(%s value): %s;", pair.left, binding, pair.right, binding, checked),
				ts:  native, decls: inlineRegexInvalidDecls, tsDecls: inlineRegexInvalidDecls,
			})
		}
		for _, mode := range []struct{ key, matcher, result, decl string }{
			{"global", "/(a)/g", "RegExpExecArray", ""},
			{"nonglobal", "/(a)/", "RegExpMatchArray", ""},
			{"value", "regexp", "RegExpMatchArray", "const regexp=/(a)/;"},
		} {
			checked := inlineRegexCheckedValue(mode.result == "RegExpExecArray")
			patterns = append(patterns, bindingHomePattern{
				name: "regex-inline-is-" + mode.key + "-" + binding, subject: "string", result: mode.result,
				arm:   fmt.Sprintf("when let ignored: (s is %s(%s value)) ? %s : fallback;", mode.matcher, binding, checked),
				ts:    "(() => { const value = " + inlineRegexNativeAttempt(mode.matcher) + "; if(value===undefined)return fallback; return " + checked + "; })()",
				decls: inlineRegexInvalidDecls + mode.decl, tsDecls: inlineRegexInvalidDecls + mode.decl,
			})
		}
	}
	return patterns
}

const inlineRegexInvalidDecls = `declare const invalidRegexMatch:string;
declare const optionalRegexMatch:RegExpMatchArray;
`

func inlineRegexCheckedValue(global bool) string {
	result := `(
// @ts-expect-error a regex match binding is an array
((candidate:typeof value)=>candidate)(invalidRegexMatch),
`
	if global {
		result += `// @ts-expect-error a global regex match has a required index
((candidate:typeof value)=>candidate)(optionalRegexMatch),
`
	}
	return result + `((candidate:typeof value)=>candidate)(fallback)
)`
}

func inlineRegexNativeAttempt(matcher string) string {
	if strings.HasSuffix(matcher, "g") {
		return "(() => {const iterator=s.matchAll(" + matcher + ");const first=iterator.next();if(first.done||!iterator.next().done)return undefined;return first.value;})()"
	}
	return "(s.match(" + matcher + ") ?? undefined)"
}
