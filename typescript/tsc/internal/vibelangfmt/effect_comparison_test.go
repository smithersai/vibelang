package vibelangfmt

import (
	"fmt"
	"testing"
)

func TestEffectTypeComparisonProjection(t *testing.T) {
	for _, host := range []string{"identity", "dprint"} {
		t.Run(host, func(t *testing.T) {
			formatter := TypeScriptFormatter(func(s string) (string, error) { return s, nil })
			if host == "dprint" {
				formatter = dprintFormatter(t)
			}
			for _, typ := range []string{"number!!", "(number!never!)", "number!never!never", "(number!!)"} {
				for _, operator := range []string{"<", "<="} {
					for _, trivia := range []string{" ", " /* comparison */ ", "\n"} {
						source := fmt.Sprintf("declare const value: unknown\nexport const result = value as %s%s%s 3\n", typ, trivia, operator)
						t.Run(typ+operator+trivia, func(t *testing.T) {
							once, err := Format("comparison.vibe", source, formatter)
							if err != nil {
								t.Fatal(err)
							}
							if err := SameProgram(source, once); err != nil {
								t.Fatal(err)
							}
							twice, err := Format("comparison.vibe", once, formatter)
							if err != nil || twice != once {
								t.Fatalf("not idempotent: %v\n%s\n%s", err, once, twice)
							}
						})
					}
				}
			}
		})
	}
}
