package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
	"strings"
	"testing"
)

func TestFormatterModuleRefusalsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", "formatting preserves parsed program meaning")
	chapterSays(t, "001-functions.md", "| the name redeclares a binding of the file | `EK4005` | rename one |")
	chapterSays(t, "007-tooling.md", "An unparsable file is reported and left unchanged; formatting is idempotent.")
}

// Negative declarations stay in the corpus. Refusals precede host callbacks.
func FuzzFormatterModuleRefusals(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"duplicate", "nameless", "distinct"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(255))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestFormatterModuleRefusalsQuoted(t)
		name := []string{"text", "helpers", "café"}[mode%3]
		head := "module " + name
		want := ""
		switch key {
		case "duplicate":
			want = "module " + name + " is declared twice"
		case "nameless":
			head = "module"
			want = "a module declaration needs a name"
		default:
			key = "distinct"
		}
		gap := " "
		if mode&4 != 0 {
			gap = " /* body */ "
		}
		source := fmt.Sprintf("%s%s{ export const one = 1 }\n", head, gap)
		if key == "duplicate" {
			source += fmt.Sprintf("module %s%s{ export const two = 2 }\n", name, gap)
		}
		if key == "distinct" {
			source += "module other { export const two = 2 }\n"
		}
		if mode&8 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		if mode&16 != 0 {
			source = "// café 😀\n" + source
		}
		file := "main.vibe"
		if mode&32 != 0 {
			file = "main.vibex"
		}
		calls := 0
		host := func(s string) (string, error) { calls++; return s, nil }
		once, err := vibelangfmt.Format(file, source, host)
		if want != "" {
			if err == nil || !strings.Contains(err.Error(), want) || calls != 0 || once != "" {
				Gap(t, "FuzzFormatterModuleRefusals", "refuse:"+key, "want %q before host call, got calls=%d output=%q error=%v\n%s", want, calls, once, err, source)
			}
			return
		}
		if err != nil || calls == 0 {
			Gap(t, "FuzzFormatterModuleRefusals", "valid:"+key, "calls=%d error=%v\n%s\n%s", calls, err, source, once)
			return
		}
		if err := vibelangfmt.SameProgram(source, once); err != nil {
			Gap(t, "FuzzFormatterModuleRefusals", "program:"+key, "%v\n%s\n%s", err, source, once)
		}
		twice, err := vibelangfmt.Format(file, once, host)
		if err != nil || twice != once {
			Gap(t, "FuzzFormatterModuleRefusals", "idempotent:"+key, "%v\n%s\n%s", err, once, twice)
		}
	})
}
