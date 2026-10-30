package vibelangfuzz

import (
	"fmt"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-28 decided detail 83 makes the helper preference and collision suffix
// deterministic. A user may declare both preferred names in the same module.
func dataHelperNameRules() []dataRule {
	const quote = "The helper for `data Outcome<A, E>` is named `$Outcome$Definition`, or `$Outcome$Definition$2`, `$3`, \u2026 when the module already declares that name, so it never collides with a user name and is the same on every build (decided detail 83)."
	var out []dataRule
	for n := 1; n <= 4; n++ {
		params := []string{"First", "Second", "Third", "Fourth"}[:n]
		var fields []string
		for i, param := range params {
			fields = append(fields, fmt.Sprintf("f%d:%s", i, param))
		}
		out = append(out, dataRule{
			name: fmt.Sprintf("generic-helper-names-%d", n), chapter: "006-data.md", quote: quote,
			source: "type $G$Definition=string; type $G$Definition$2=number; export data G<" + strings.Join(params, ",") + "> { V {" + strings.Join(fields, ";") + "} }",
			owner:  "vip-core2",
		})
	}
	return out
}

func checkDataHelperName(t *testing.T, c dataRule, r *Result) {
	t.Helper()
	if !strings.HasPrefix(c.name, "generic-helper-names-") {
		return
	}
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			return
		} // acceptance reports it
	}
	want := "$G$Definition$3"
	text := r.Outputs["out/main.d.ts"]
	pattern := regexp.MustCompile("\\b(?:interface|type)\\s+" + regexp.QuoteMeta(want) + "\\b")
	if !pattern.MatchString(text) {
		Gap(t, dataRuleTarget, "feature:"+c.name, "chapter 6 requires helper %s after the first two names are occupied; got declarations:\n%s\n%s", want, text, Archive(r.Sources))
	}
}
