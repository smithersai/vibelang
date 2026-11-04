package vibelang

import (
	"strings"
	"testing"
)

func TestQuickFixProtectsPlainTry(t *testing.T) {
	for _, expr := range []string{"try Effect.succeed(7)", "try (Effect.succeed(7))"} {
		for _, eol := range []string{"\n", "\r\n"} {
			source := "// comment 😀" + eol + "export function main(){return " + expr + "}" + eol
			result, name := fixSourceOptions(t, source, FixOptions{})
			got := source
			if f := result.Files[name]; f != nil {
				got = f.Text
			}
			if got != source {
				t.Fatalf("changed refused plain try: %s", got)
			}
			found := false
			for _, site := range result.Sites {
				if site.Code == "EK0501" {
					found = true
				}
			}
			if !found {
				t.Fatal("missing refused EK0501 span")
			}
			if !strings.Contains(got, expr) {
				t.Fatal("lost try operand")
			}
		}
	}
}
