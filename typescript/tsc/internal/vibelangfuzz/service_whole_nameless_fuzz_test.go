package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const wholeNamelessQuote = "any member other than a [KeyMember]"
const namelessQuote = "a \x60constructor\x60, an index signature"

func wholeNamelessChapter(t testing.TB) string {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{wholeNamelessQuote, namelessQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
	return string(text)
}
func TestWholeServiceNamelessQuoted(t *testing.T) { wholeNamelessChapter(t) }

func FuzzWholeServiceNamelessMembers(f *testing.F) {
	startShortBudget(f)
	chapter := wholeNamelessChapter(f)
	shapes := []string{"body", "named", "scalar"}
	members := []struct{ key, source string }{
		{"string-index", "[key: string]: unknown"},
		{"symbol-index", "readonly [key: symbol]: unknown"},
		{"number-index", "[key: number]: unknown"},
		{"constructor", "constructor() { super() }"},
		{"empty", ""},
	}
	for _, shape := range shapes {
		for _, m := range members {
			f.Add([]byte(shape + ":" + m.key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		shape, member := 0, 0
		if len(data) > 0 {
			shape = int(data[0]) % len(shapes)
		}
		if len(data) > 1 {
			member = int(data[1]) % len(members)
		}
		for si, s := range shapes {
			for mi, m := range members {
				if string(data) == s+":"+m.key {
					shape, member = si, mi
				}
			}
		}
		key := shapes[shape] + ":" + members[member].key
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
		source := "type Shape = number;" + gap + "export service S" + annotation + " { static readonly key = \"whole/S\"; /* member */ " + members[member].source + " }" + gap +
			"export class Ordinary { [key: string]: unknown; constructor(public readonly n: number) {} }"
		if len(data) > 3 && data[3]%2 == 1 {
			source = strings.ReplaceAll(source, "\"", "'")
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage},
			Config: `{"compilerOptions":{"target":"ES2022","lib":["ES2022"],"module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]},"files":["main.vibe"]}`})
		if err != nil {
			Gap(t, "FuzzWholeServiceNamelessMembers", key, "compile: %v", err)
			return
		}
		defer r.Remove()
		code := servicesRuleDiagnostic(chapter, namelessQuote)
		if code == 0 {
			t.Fatal("chapter 5 has no nameless-member code")
		}
		want := 1
		if members[member].source == "" {
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
				Gap(t, "FuzzWholeServiceNamelessMembers", key, "unexpected %s\n%s", d.String(), source)
				return
			}
		}
		if got != want {
			Gap(t, "FuzzWholeServiceNamelessMembers", key, "want %d EK%04d, got %d\n%s", want, code, got, source)
			return
		}
		ExpectPending(t, "FuzzWholeServiceNamelessMembers", key)
		ExpectPending(t, "FuzzWholeServiceNamelessMembers", specCorpusKey(t))
	})
}
