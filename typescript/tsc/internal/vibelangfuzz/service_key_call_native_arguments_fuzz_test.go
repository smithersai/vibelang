package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceKeyCallNativeQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."

func serviceKeyCallNativeChapter(t testing.TB) {
	t.Helper()
	b, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), serviceKeyCallNativeQuote) {
		t.Fatal("native diagnostic rule changed")
	}
}
func TestServiceKeyCallNativeArgumentsQuoted(t *testing.T) { serviceKeyCallNativeChapter(t) }
func FuzzServiceKeyCallNativeArguments(f *testing.F) {
	startShortBudget(f)
	serviceKeyCallNativeChapter(f)
	rules := []struct {
		key, argument string
		native        int32
	}{
		{"not-callable", "(1)()", 2349},
		{"arity", "((n: number) => n)()", 2554},
		{"too-many", "((n: number) => n)(1, 2)", 2554},
		{"constructor-arity", "new (class { constructor(n: number) {} })()", 2554},
		{"nested-method", "({ method(n: number) {} }).method()", 2554},
		{"callback-arity", "() => ((n: number) => n)()", 2554},
		{"nested-call", "() => (1)()", 2349},
		{"missing-name", "Missing", 2304},
		{"argument-type", "((n: number) => n)(\"bad\")", 2345},
		{"property", "({}).missing", 2339},
		{"clean", "1", 0},
		{"clean-callback", "() => 1", 0},
	}
	keys := []string{}
	for _, rule := range rules {
		keys = append(keys, rule.key)
		f.Add([]byte(rule.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		index := slices.Index(keys, parts[0])
		if index < 0 {
			index = len(data) % len(rules)
		}
		rule := rules[index]
		variant := byte(len(data))
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		source := `service S { static readonly key = "call/S"; n: number;`
		if variant&1 != 0 {
			source += `static readonly defaultValue = () => ({ n: 1 });`
		}
		source += "}"
		callee := "S"
		if variant&2 != 0 {
			callee = "(S)"
		}
		source += callee + "(" + rule.argument + ");"
		if variant&4 != 0 {
			source = "// retained trivia\r\n" + source
		}
		r, err := w.Compile(t.Context(), Project{
			Config: `{"compilerOptions":{"target":"ES2022","lib":["ES2022"],"module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]},"files":["main.vibe"]}`,
			Files:  map[string]string{"main.vibe": source, "package.json": servicesPackage},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := map[int32]int{}
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got[d.Code()]++
			}
		}
		want := 1
		if rule.native != 0 {
			want++
		}
		if len(got) != want || got[9214] != 1 || rule.native != 0 && got[rule.native] != 1 {
			Gap(t, "FuzzServiceKeyCallNativeArguments", rule.key, "%s; want EK9214 and independent TS%d, got %v", serviceKeyCallNativeQuote, rule.native, got)
			return
		}
		ExpectPending(t, "FuzzServiceKeyCallNativeArguments", rule.key)
		ExpectPending(t, "FuzzServiceKeyCallNativeArguments", specCorpusKey(t))
	})
}
