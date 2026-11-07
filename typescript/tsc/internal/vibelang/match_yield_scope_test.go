package vibelang

import (
	"fmt"
	"testing"
)

func TestMatchYieldScope(t *testing.T) {
	for _, async := range []bool{false, true} {
		for _, parens := range []bool{false, true} {
			for _, home := range []string{"arm", "subject", "statement", "expression", "initializer"} {
				t.Run(fmt.Sprintf("%s/async=%v/parens=%v", home, async, parens), func(t *testing.T) {
					modifier, iterator := "", "Generator"
					if async {
						modifier, iterator = "async ", "AsyncGenerator"
					}
					subject, next := "source", "number"
					arm := "yield value"
					if home == "subject" {
						subject, next, arm = "yield source.field", "{field:number}", "value"
					}
					expression := "match(" + subject + "){when {field:let value}:" + arm + ";default:0;}"
					if parens {
						expression = "(" + expression + ")"
					}
					body := "return " + expression
					switch home {
					case "statement":
						body = expression + ";return 0"
					case "expression":
						body = "return 1+(" + expression + ")"
					case "initializer":
						body = "const result=" + expression + ";return result"
					}
					source := "export " + modifier + "function* select(source:{field:number}):" + iterator + "<number,number," + next + ">{" + body + "}"
					defer func() {
						if value := recover(); value != nil {
							t.Errorf("checking a valid yielding match panicked: %v\n%s", value, source)
						}
					}()
					if errors := errorsOf(t, source); len(errors) != 0 {
						t.Errorf("yield lost its enclosing scope: %v\n%s", errors, source)
					}
				})
			}
		}
	}
}
