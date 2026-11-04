package vibelang

import (
	"fmt"
	"testing"
)

func TestErrorStaticConstructorPriority(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, modifier := range []string{"static", "public static", "private static", "protected static"} {
			for _, name := range []string{"constructor", "\"constructor\"", "[\"constructor\"]"} {
				for _, parameters := range []string{"", "value:number"} {
					source := fmt.Sprintf("%s E {%s %s(%s){}}\n", form, modifier, name, parameters)
					t.Run(source, func(t *testing.T) {
						want := "EK1301"
						if name == "[\"constructor\"]" {
							want = "EK1302"
						}
						codes := errorCodesOf(t, source)
						if len(codes) != 1 || codes[0] != want {
							t.Fatalf("got%v want one%s", codes, want)
						}
					})
				}
			}
		}
	}
}
