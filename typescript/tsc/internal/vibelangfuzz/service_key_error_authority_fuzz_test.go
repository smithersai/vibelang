package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const keyErrorQuote = "without \x60readonly\x60, or a \x60key\x60 whose initializer is not a string literal"

func keyErrorAuthorityChapter(t testing.TB) string {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), keyErrorQuote) {
		t.Fatalf("chapter 5 no longer says %q", keyErrorQuote)
	}
	return string(text)
}
func TestServiceKeyErrorAuthorityQuoted(t *testing.T) { keyErrorAuthorityChapter(t) }
func FuzzServiceKeyErrorAuthority(f *testing.F) {
	startShortBudget(f)
	chapter := keyErrorAuthorityChapter(f)
	shapes := []string{"body", "named", "scalar"}
	rules := []struct{ key, member string }{}
	for _, access := range []string{"public", "private", "protected"} {
		for _, kind := range []string{"template", "number", "mutable"} {
			member := access + " static readonly key = "
			switch kind {
			case "template":
				member += "\x60keys/S\x60"
			case "number":
				member += "7"
			case "mutable":
				member = access + " static key = \"keys/S\""
			}
			rules = append(rules, struct{ key, member string }{access + "-" + kind, member})
		}
	}
	rules = append(rules, struct{ key, member string }{"valid", "static readonly key: string = \"keys/S\""})
	for _, shape := range shapes {
		for _, rule := range rules {
			f.Add([]byte(shape + ":" + rule.key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		shape, rule := 0, 0
		if len(data) > 0 {
			shape = int(data[0]) % len(shapes)
		}
		if len(data) > 1 {
			rule = int(data[1]) % len(rules)
		}
		for si, s := range shapes {
			for ri, r := range rules {
				if string(data) == s+":"+r.key {
					shape, rule = si, ri
				}
			}
		}
		key := shapes[shape] + ":" + rules[rule].key
		annotation := ""
		if shape == 1 {
			annotation = ": Shape"
		} else if shape == 2 {
			annotation = ": number"
		}
		gap := "\n"
		if len(data) > 2 && data[2]%2 == 1 {
			gap = "\r\n"
		}
		source := "type Shape = number;" + gap + "export service S" + annotation + " { /* key */ " + rules[rule].member + " }" + gap +
			"export class Native { private static readonly key = 7; static read() { return this.key } }"
		if len(data) > 3 && data[3]%2 == 1 {
			source = strings.ReplaceAll(source, "\"", "'")
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage},
			Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"main.vibe\"]}"})
		if err != nil {
			Gap(t, "FuzzServiceKeyErrorAuthority", key, "compile: %v", err)
			return
		}
		defer r.Remove()
		code := servicesRuleDiagnostic(chapter, keyErrorQuote)
		if code == 0 {
			t.Fatal("chapter 5 has no literal-key code")
		}
		want := 1
		if rules[rule].key == "valid" {
			want = 0
		}
		got := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == code {
				got++
			} else {
				Gap(t, "FuzzServiceKeyErrorAuthority", key, "unexpected %s\n%s", d.String(), source)
				return
			}
		}
		if got != want {
			Gap(t, "FuzzServiceKeyErrorAuthority", key, "want %d EK%04d, got %d\n%s", want, code, got, source)
			return
		}
		ExpectPending(t, "FuzzServiceKeyErrorAuthority", key)
		ExpectPending(t, "FuzzServiceKeyErrorAuthority", specCorpusKey(t))
	})
}
