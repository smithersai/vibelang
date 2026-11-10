package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var declarationDecoratorRecoveryQuotes = []string{
	"ServiceStart     = \"service\" [no LineTerminator here] BindingIdentifier",
	"ErrorStart       = \"error\"   [no LineTerminator here] BindingIdentifier",
	"SchemaErrorStart = \"schema\"  [no LineTerminator here] \"error\" [no LineTerminator here] BindingIdentifier",
	"SchemaStart      = \"schema\"  [no LineTerminator here] BindingIdentifier",
	"DataStart        = \"data\"    [no LineTerminator here] BindingIdentifier",
}

func declarationDecoratorRecoveryQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range declarationDecoratorRecoveryQuotes {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("Appendix A declaration start changed: %s", quote)
		}
	}
}

func TestDeclarationDecoratorRecoveryQuoted(t *testing.T) {
	declarationDecoratorRecoveryQuoted(t)
}

// Appendix A's custom declaration starts contain no DecoratorList. As for
// TypeScript's type alias, one TS1206 marks the first decorator's @; native
// classes keep decorators. Layout, exports and decorator expressions do not
// turn a custom declaration into a native decorated class.
func FuzzDeclarationDecoratorRecovery(f *testing.F) {
	startShortBudget(f)
	declarationDecoratorRecoveryQuoted(f)
	keys := []string{"service", "error", "schema-error", "schema", "schema-alias", "data", "class", "undecorated"}
	for _, key := range keys {
		f.Add([]byte(key))
		for variant := byte(0); variant < 8; variant++ {
			f.Add(append([]byte(key+"\x00"), variant))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			key = keys[len(data)%len(keys)]
		}
		variant := byte(len(data))
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		decl := map[string]string{
			"service":      "service S { static readonly key = \"decorator/S\"; n: number }",
			"error":        "error E { id: string }",
			"schema-error": "schema error E { id: Schema.String }",
			"schema":       "schema S { id: Schema.String }",
			"schema-alias": "schema S = string",
			"data":         "data D { A; B }",
			"class":        "class C { n = 1 }",
			"undecorated":  "service S { static readonly key = \"decorator/S\"; n: number }",
		}[key]
		prefix := "@dec "
		if variant&1 != 0 {
			prefix = "@(dec) /* decorator */\n"
		}
		if variant&2 != 0 {
			prefix = "@dec " + prefix
		}
		if variant&4 != 0 {
			prefix = "export " + prefix
		}
		if key == "undecorated" {
			prefix = ""
		}
		source := "function dec(value: unknown, context: unknown) {}\n" + prefix + decl + "\nexport {}\n"
		r, err := w.Compile(t.Context(), Project{
			Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]},"files":["main.vibe"]}`,
			Files:  map[string]string{"main.vibe": source, "package.json": servicesPackage},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		want := key != "class" && key != "undecorated"
		var found int
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if d.Code() == 1206 && want {
				found++
				if d.Pos() != strings.Index(source, "@") || source[d.Pos():d.End()] != "@" {
					Gap(t, "FuzzDeclarationDecoratorRecovery", key, "TS1206 must span the first decorator's @: %s", d.String())
				}
			} else {
				Gap(t, "FuzzDeclarationDecoratorRecovery", key, "unexpected diagnostic: %s\n%s", d.String(), source)
			}
		}
		if want && found != 1 {
			Gap(t, "FuzzDeclarationDecoratorRecovery", key, "custom declaration needs exactly one TS1206, got %d\n%s", found, source)
		}
		ExpectPending(t, "FuzzDeclarationDecoratorRecovery", key)
		ExpectPending(t, "FuzzDeclarationDecoratorRecovery", specCorpusKey(t))
	})
}
