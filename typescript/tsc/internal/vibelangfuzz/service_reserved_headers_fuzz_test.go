package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var reservedServiceHeaders = []struct {
	key, member string
	keyError    bool
}{
	{"key-private", "private static readonly key = \"headers/S\"", false},
	{"key-public", "public static readonly key = \"headers/S\"", false},
	{"key-protected", "protected static readonly key = \"headers/S\"", false},
	{"key-declare", "declare static readonly key = \"headers/S\"", false},
	{"key-optional", "static readonly key?: string = \"headers/S\"", false},
	{"key-definite", "static readonly key!: string = \"headers/S\"", false},
	{"default-private", "private static readonly defaultValue = () => 1", false},
	{"default-public", "public static readonly defaultValue = () => 1", false},
	{"default-protected", "protected static readonly defaultValue = () => 1", false},
	{"default-declare", "declare static readonly defaultValue = () => 1", false},
	{"default-optional", "static readonly defaultValue?: () => number = () => 1", false},
	{"default-definite", "static readonly defaultValue!: () => number = () => 1", false},
	{"default-mutable", "static defaultValue = () => 1", false},
	{"default-missing", "static readonly defaultValue: () => number", false},
	{"key-mutable-precedence", "public static key = \"headers/S\"", true},
	{"key-template-precedence", "public static readonly key = `headers/S`", true},
	{"key-valid", "static readonly key: string = \"headers/S\"", false},
	{"default-valid", "static readonly defaultValue: () => number = () => 1", false},
}

func reservedServiceHeadersChapter(t testing.TB) string {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{
		"Existing key, default, ambient and generic-capture rules apply.",
		"a body, an initializer, a modifier",
		"without `readonly`, or a `key` whose initializer is not a string literal",
	} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
	return string(text)
}
func TestServiceReservedHeadersQuoted(t *testing.T) { reservedServiceHeadersChapter(t) }

// The whole-shape amendment retains the same KeyMember and DefaultMember
// grammar as a member-body declaration; malformed headers get its first
// applicable diagnostic, while ordinary classes retain native rules.
func FuzzServiceReservedHeaders(f *testing.F) {
	startShortBudget(f)
	chapter := reservedServiceHeadersChapter(f)
	shapes := []string{"body", "named", "scalar"}
	for _, shape := range shapes {
		for _, item := range reservedServiceHeaders {
			f.Add([]byte(shape + ":" + item.key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, shape := 0, 0
		if len(data) > 0 {
			choice = int(data[0]) % len(reservedServiceHeaders)
		}
		if len(data) > 1 {
			shape = int(data[1]) % len(shapes)
		}
		for si, s := range shapes {
			for i, r := range reservedServiceHeaders {
				if string(data) == s+":"+r.key {
					choice, shape = i, si
				}
			}
		}
		rule := reservedServiceHeaders[choice]
		key := shapes[shape] + ":" + rule.key
		head, members := "", ""
		if shape == 1 {
			head = ": Shape"
		} else if shape == 2 {
			head = ": number"
		}
		if strings.HasPrefix(rule.key, "default-") {
			members = "static readonly key = \"headers/S\";"
		}
		members += rule.member
		newline := "\n"
		if len(data) > 2 && data[2]%2 == 1 {
			newline = "\r\n"
		}
		if len(data) > 3 && data[3]%2 == 1 {
			members = strings.ReplaceAll(members, "\"", "'")
		}
		source := "type Shape = number;" + newline + "export service S" + head + " { /* header */ " + members + " }" + newline +
			"export class Ordinary { private static readonly key = \"native\"; static defaultValue = () => 1; static read() { return this.key } }" + newline
		ext := "vibe"
		if len(data) > 4 && data[4]%2 == 1 {
			ext = "vibex"
		}
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","lib":["ES2022"],"module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"jsx":"preserve"},"files":["main.%s"]}`, ext)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main." + ext: source, "package.json": servicesPackage}, Config: config})
		if err != nil {
			Gap(t, "FuzzServiceReservedHeaders", key, "compile: %v", err)
			return
		}
		defer r.Remove()
		code := servicesRuleDiagnostic(chapter, "a body, an initializer, a modifier")
		if rule.keyError {
			code = servicesRuleDiagnostic(chapter, "without `readonly`, or a `key` whose initializer is not a string literal")
		}
		if code == 0 {
			t.Fatal("no diagnostic assigned by chapter 5")
		}
		want := 1
		if strings.HasSuffix(rule.key, "-valid") {
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
				Gap(t, "FuzzServiceReservedHeaders", key, "unexpected diagnostic: %s\n%s", d.String(), source)
				return
			}
		}
		if got != want {
			Gap(t, "FuzzServiceReservedHeaders", key, "want %d EK%04d, got %d\n%s", want, code, got, source)
			return
		}
		ExpectPending(t, "FuzzServiceReservedHeaders", key)
		ExpectPending(t, "FuzzServiceReservedHeaders", specCorpusKey(t))
	})
}
