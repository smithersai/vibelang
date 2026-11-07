package vibelangfuzz

import (
	"fmt"
	"os/exec"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestTypedEffectInitializerTryQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "| `try e` | one Effect, giving its success |")
	chapterSays(t, "002-running.md", "Returning an Effect does not itself execute it.")
}

func FuzzTypedEffectInitializerTry(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"direct", "alias", "union"} {
		for flags := uint8(0); flags < 16; flags++ {
			f.Add(key, flags)
		}
	}
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestTypedEffectInitializerTryQuoted(t)
		kind := "const"
		if flags&1 != 0 {
			kind = "let"
		}
		typ := "E.Effect<number>"
		switch key {
		case "alias":
			typ = "Job"
		case "union":
			typ = "E.Effect<number>|E.Effect<number>"
		}
		cold := flags&4 != 0
		reportKey := key
		if cold && kind == "let" {
			reportKey = "cold-let-initializer"
		}
		prefix := "try "
		if cold {
			typ = "E.Effect<E.Effect<number>>"
			prefix = ""
		}
		call := fmt.Sprintf("E.sync(()=>E.succeed(%d))", flags%31)
		if flags&8 != 0 {
			call = "(" + call + ")"
		}
		value := prefix + call
		if flags&2 != 0 {
			value = "(" + value + ")"
		}
		source := `import {Effect as E} from "effect";type Job=E.Effect<number>;export effect function main(){` + kind + ` program:` + typ + `=` + value + `;const value=try program;void value;return 0}`
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(p.Diagnostics) != 0 {
			Gap(t, "FuzzTypedEffectInitializerTry", reportKey, "admitted initializer reports %v", p.Diagnostics)
		}
		runs := strings.Contains(p.Text, "$try(E.sync(") || strings.Contains(p.Text, "$run(E.sync(")
		if runs == cold || strings.Count(p.Text, "E.sync(") != 1 {
			Gap(t, "FuzzTypedEffectInitializerTry", reportKey, "written initializer execution and cold value construction must differ: %s", p.Text)
		}
		js, _, diagnostics := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
		if len(diagnostics) != 0 {
			Gap(t, "FuzzTypedEffectInitializerTry", reportKey, "executable initializer reports %v", diagnostics)
		}
		cmd := exec.CommandContext(t.Context(), "node", "--input-type=module", "--check")
		cmd.Stdin = strings.NewReader(js)
		if output, err := cmd.CombinedOutput(); err != nil {
			Gap(t, "FuzzTypedEffectInitializerTry", reportKey, "invalid emitted JS: %v\n%s\n%s", err, output, js)
		}
		ExpectPending(t, "FuzzTypedEffectInitializerTry", reportKey)
	})
}
