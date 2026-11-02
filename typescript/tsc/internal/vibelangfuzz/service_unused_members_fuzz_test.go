package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var serviceUnusedMembers = []struct {
	key, member string
	code        int32
}{
	{"method", "read(n: number): number!!", 0},
	{"property", "value: number", 0},
	{"optional-method", "read?(n: number): number!!", 0},
	{"readonly-property", "readonly value: number", 0},
	{"generic-method", "map<A>(value: A): A", 0},
	{"mixed", "read(n: number): number!!, value: number,", 0},
	{"call-signature", "(value: number): number", 902},
	{"generic-call", "<A>(value: A): A", 902},
	{"construct-signature", "new(): number", 902},
	{"generic-construct", "new<A>(value: A): A", 902},
}

func serviceUnusedQuoted(t testing.TB) string {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{
		"A member is typed as in an `interface`, because it has no body to infer from",
		"a call signature `(x: number): string`",
		"a construct signature `new (): X`",
	} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
	return string(text)
}
func TestServiceUnusedMembersQuoted(t *testing.T) { serviceUnusedQuoted(t) }

func FuzzServiceUnusedMembers(f *testing.F) {
	startShortBudget(f)
	chapter := serviceUnusedQuoted(f)
	for _, r := range serviceUnusedMembers {
		f.Add([]byte(r.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice := 0
		if len(data) > 0 {
			choice = int(data[0]) % len(serviceUnusedMembers)
		}
		for i, r := range serviceUnusedMembers {
			if string(data) == r.key {
				choice = i
				break
			}
		}
		rule := serviceUnusedMembers[choice]
		if rule.code != 0 {
			quote := "a call signature `(x: number): string`"
			if strings.HasPrefix(rule.member, "new") {
				quote = "a construct signature `new (): X`"
			}
			rule.code = servicesRuleDiagnostic(chapter, quote)
			if rule.code == 0 {
				t.Fatalf("no chapter 5 code for %s", quote)
			}
		}

		params := "true"
		if len(data) > 1 && data[1]%2 == 1 {
			params = "false"
		}
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"noUnusedLocals":true,"noUnusedParameters":%s},"files":["main.vibe"]}`, params)
		source := "export service S { static readonly key = \"unused/S\"; " + rule.member + " }\n"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}, Config: config})
		if err != nil {
			Gap(t, "FuzzServiceUnusedMembers", "check:"+rule.key, "chapter 5 types members as interface contracts; unused checking failed: %v\n%s", err, source)
			return
		}
		defer r.Remove()
		found := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if rule.code != 0 && IsEK(d) && d.Code() == rule.code {
				found++
				continue
			}
			Gap(t, "FuzzServiceUnusedMembers", "check:"+rule.key, "chapter 5 types members as interface contracts and rejects call/construct signatures; got %s\n%s", d.String(), source)
			return
		}
		if rule.code != 0 && found != 1 {
			Gap(t, "FuzzServiceUnusedMembers", "check:"+rule.key, "want one EK0902, got %d\n%s", found, source)
			return
		}
		ExpectPending(t, "FuzzServiceUnusedMembers", "check:"+rule.key)
		ExpectPending(t, "FuzzServiceUnusedMembers", specCorpusKey(t))
	})
}
