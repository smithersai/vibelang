package vibelang

import (
	"strings"
	"testing"
)

const namedPackage = `{"name":"@acme/pkg","type":"module"}`

func TestServiceBodyFix(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"primitive", "service Prefix: string\nexport const p = Prefix\n", "service Prefix: string {}\n"},
		{"callable", "service Format: (value: string) => string\nexport const f = Format\n", "service Format: (value: string) => string {}\n"},
		{"union", "service Id: string | number\nexport const i = Id\n", "service Id: string | number {}\n"},
		{"exported", "export service Prefix: string\n", "export service Prefix: string {}\n"},
		{"two", "service A: string\nservice B: number\nexport const p = [A, B]\n", "service A: string {}\nservice B: number {}\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := fixProjectOf(t, map[string]string{"main.vibe": test.source, "package.json": namedPackage})
			got := fixedText(result, "main.vibe")
			if result.Err != nil || !strings.Contains(got, test.want) {
				t.Fatalf("err=%v refused=%+v\n%s", result.Err, result.Refused, got)
			}
		})
	}
}

// A header with no shape has members only its author knows, and a written body stays as it is.
func TestServiceBodyFixControls(t *testing.T) {
	for _, source := range []string{"service Missing\nexport const m = Missing\n", "service Prefix: string {}\nexport const p = Prefix\n"} {
		result := fixProjectOf(t, map[string]string{"main.vibe": source, "package.json": namedPackage})
		if got := fixedText(result, "main.vibe"); got != "" && got != source {
			t.Fatalf("changed %q to %q", source, got)
		}
	}
}

// Where no key can be derived, EK0903's fix owns the body and writes the key into it.
func TestServiceBodyFixLeavesTheKeyFix(t *testing.T) {
	result := fixProjectOf(t, map[string]string{"main.vibe": "service Prefix: string\nexport const p = Prefix\n"})
	if got := fixedText(result, "main.vibe"); !strings.Contains(got, "static readonly key =") {
		t.Fatalf("err=%v\n%s", result.Err, got)
	}
}
