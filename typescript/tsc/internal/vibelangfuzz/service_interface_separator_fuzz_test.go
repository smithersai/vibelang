package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var serviceSeparatorMembers = [][2]string{
	{"left(): Effect.Effect<number>", "right(): Effect.Effect<string>"},
	{"left: () => Effect.Effect<number>", "right: () => Effect.Effect<string>"},
	{"left: () => Effect.Effect<number>", "right(): Effect.Effect<string>"},
}
var serviceSeparatorKinds = []string{"methods", "properties", "mixed"}
var serviceSeparatorTokens = []struct {
	key, text string
	missing   bool
}{
	{"space", " ", true}, {"comment", " /* gap */ ", true}, {"comma", ", ", false}, {"semicolon", "; ", false}, {"newline", "\n", false},
}

func serviceInterfaceSeparatorsQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("005-services.md")
	for _, quote := range []string{
		"Members are separated as in an `interface`",
		"`a: number b: string` on one line is a syntax error, `EK0908`",
	} {
		if !strings.Contains(text, quote) {
			t.Fatalf("Chapter5 no longer says %q", quote)
		}
	}
}
func TestServiceInterfaceSeparatorsQuoted(t *testing.T) { serviceInterfaceSeparatorsQuoted(t) }
func FuzzServiceInterfaceSeparators(f *testing.F) {
	startShortBudget(f)
	serviceInterfaceSeparatorsQuoted(f)
	for _, kind := range serviceSeparatorKinds {
		for _, sep := range serviceSeparatorTokens {
			key := kind + ":" + sep.key
			f.Add([]byte(key))
			f.Add([]byte(key + "\x00\x03"))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key, flags, _ := strings.Cut(string(data), "\x00")
		memberIndex, separatorIndex := 0, 0
		if len(data) > 0 {
			memberIndex = int(data[0]) % len(serviceSeparatorMembers)
			separatorIndex = int(data[len(data)-1]) % len(serviceSeparatorTokens)
		}
		for i, kind := range serviceSeparatorKinds {
			for j, sep := range serviceSeparatorTokens {
				if key == kind+":"+sep.key {
					memberIndex, separatorIndex = i, j
				}
			}
		}
		members, sep := serviceSeparatorMembers[memberIndex], serviceSeparatorTokens[separatorIndex]
		name, prefix := "Users", ""
		if len(flags) > 0 && flags[0]&1 != 0 {
			name = "UsersCafé"
			prefix = "// retained trivia\n"
		}
		if len(flags) > 0 && flags[0]&2 != 0 {
			members[0] = strings.ReplaceAll(members[0], "left", "\"left\"")
			members[1] = strings.ReplaceAll(members[1], "right", "\"right\"")
		}
		source := prefix + fmt.Sprintf("export service %s { static readonly key = \"separators/Users\"; %s%s%s }\n", name, members[0], sep.text, members[1])
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 908 {
				count++
				continue
			}
			Gap(t, "FuzzServiceInterfaceSeparators", serviceSeparatorKinds[memberIndex]+":"+sep.key+":unexpected", "unexpected diagnostic %s\n%s", d.String(), source)
		}
		want := 0
		if sep.missing {
			want = 1
		}
		if count != want {
			Gap(t, "FuzzServiceInterfaceSeparators", serviceSeparatorKinds[memberIndex]+":"+sep.key, "want %d EK0908, got %d\n%s", want, count, source)
		}
	})
}
