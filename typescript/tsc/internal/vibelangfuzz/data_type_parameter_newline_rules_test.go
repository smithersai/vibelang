package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// Static grammar generator: DataStart forbids a line break before its name;
// DataDeclaration has no such restriction before TypeParameters or its body.
func dataTypeParameterNewlineRules() []dataRule {
	const quote = "DataDeclaration = DataStart TypeParameters? \"{\" (Variant (Separator Variant)* Separator?)? \"}\""
	var rules []dataRule
	for i, trivia := range []string{" ", "\n", "\r\n", "\r", "\u2028", "\u2029", " /*\n*/ ", " // parameters\n"} {
		for n := 1; n <= 4; n++ {
			params := []string{"A", "B", "C", "D"}[:n]
			var fields []string
			for j, param := range params {
				fields = append(fields, fmt.Sprintf("v%d: %s", j, param))
			}
			for _, exported := range []bool{false, true} {
				prefix := ""
				if exported {
					prefix = "export "
				}
				rules = append(rules, dataRule{
					name:    fmt.Sprintf("data-type-parameter-newline-%d-%d-%t", i, n, exported),
					chapter: "900-appendices.md", quote: quote,
					source: prefix + "data Name" + trivia + "<" + strings.Join(params, ",") + ">" + trivia + "{ Ok { " + strings.Join(fields, ";") + " } }",
					owner:  "conf-auto-data-type-parameter-newline",
				})
			}
		}
	}
	return rules
}

func TestDataTypeParameterNewlineQuoted(t *testing.T) {
	for _, c := range dataTypeParameterNewlineRules() {
		if !strings.Contains(SpecText(c.chapter), c.quote) {
			t.Fatalf("stale oracle %s: chapter %s no longer says %q", c.name, c.chapter, c.quote)
		}
	}
}
