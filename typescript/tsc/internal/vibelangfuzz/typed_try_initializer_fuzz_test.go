package vibelangfuzz

import (
	"fmt"
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
	node := newMapperTryNode(f)
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
		call := fmt.Sprintf("E.sync(()=>{ev('outer');return E.sync(()=>{ev('inner');return %d})})", flags%31)
		if flags&8 != 0 {
			call = "(" + call + ")"
		}
		value := prefix + call
		if flags&2 != 0 {
			value = "(" + value + ")"
		}
		source := `import {Effect as E} from "effect";import {ev} from "vip-events";type Job=E.Effect<number>;export effect function main(){` + kind + ` program:` + typ + `=` + value + `;ev("between");const value=try program;`
		if cold {
			source += `return try value}`
		} else {
			source += `return value}`
		}
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(p.Diagnostics) != 0 {
			Gap(t, "FuzzTypedEffectInitializerTry", reportKey, "admitted initializer reports %v", p.Diagnostics)
		}
		js, _, diagnostics := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
		if len(diagnostics) != 0 {
			Gap(t, "FuzzTypedEffectInitializerTry", reportKey, "executable initializer reports %v", diagnostics)
		}
		steps := "ev('outer'); ev('between');"
		if cold {
			steps = "ev('between'); ev('outer');"
		}
		reference := fmt.Sprintf("export const main=()=>E.gen(function*(){%s return yield* E.sync(()=>{ev('inner');return %d});});", steps, flags%31)
		checkMapperTryExecution(t, node, "FuzzTypedEffectInitializerTry", reportKey, js, reference)
		ExpectPending(t, "FuzzTypedEffectInitializerTry", reportKey)
		ExpectPending(t, "FuzzTypedEffectInitializerTry", specCorpusKey(t))
	})
}
