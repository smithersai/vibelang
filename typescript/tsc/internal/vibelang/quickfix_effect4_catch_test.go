package vibelang

import (
	"strings"
	"testing"
)

func TestQuickFixRenamesEffect4Catch(t *testing.T) {
	for _, name := range []string{"catchAll", "catchAllCause", "catchAllDefect"} {
		for _, eol := range []string{"\n", "\r\n"} {
			source := "// kept 😀" + eol + "export function main(){return Effect." + name + "(Effect.fail(\"oops\"),()=>Effect.succeed(7))}" + eol
			result, path := fixSourceOptions(t, source, FixOptions{})
			got := source
			if f := result.Files[path]; f != nil {
				got = f.Text
			}
			if strings.Contains(got, name+"(") {
				t.Fatalf("left removed API %s: %s", name, got)
			}
			want := strings.Replace(name, "catchAll", "catch", 1)
			if !strings.Contains(got, want+"(") || !strings.Contains(got, "// kept 😀") {
				t.Fatalf("lost rename or comment: %s", got)
			}
		}
	}
}
