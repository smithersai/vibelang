package vibelangfuzz

import (
	"fmt"
	"os/exec"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestHeldComputedMethodKeyQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "A computed class key and an `extends` clause are effect code, as `await` is allowed there")
	chapterSays(t, "002-running.md", "| `try e` | one Effect, giving its success |")
}

func FuzzHeldComputedMethodKey(f *testing.F) {
	startShortBudget(f)
	rows := []struct{ key, value string }{
		{"method", `{[KEY]():number{return 7}}`},
		{"getter", `{get [KEY]():number{return 7}}`},
		{"setter", `{set [KEY](value:number){void value}}`},
		{"class", `class{[KEY]():number{return 7}}`},
		{"static", `class{static [KEY]():number{return 7}}`},
		{"property", `{[KEY]:7}`},
	}
	f.Add("unrecognized-key", uint8(0))
	for _, row := range rows {
		f.Add(row.key, uint8(64))
		f.Add(row.key, uint8(128))
		f.Add(row.key, uint8(192))
		for flags := uint8(0); flags < 12; flags++ {
			f.Add(row.key, flags)
		}
	}
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestHeldComputedMethodKeyQuoted(t)
		row := rows[0]
		for _, candidate := range rows {
			if candidate.key == key {
				row = candidate
				break
			}
		}
		gap := []string{" ", " /* key */ ", "\t"}[(flags/4)%3]
		cold := flags&128 != 0
		expression := fmt.Sprintf("try%sE.sync(():string=>%q)", gap, fmt.Sprintf("key%d", flags%50))
		if cold {
			expression = "(" + strings.TrimPrefix(expression, "try") + " as any)"
		}
		value := strings.Replace(row.value, "KEY", expression, 1)
		operator := []string{"try.all", "try.race", "try.any", "try.allSettled"}[flags%4]
		collection := operator + " [E.succeed(" + value + ")]"
		if flags&64 != 0 {
			collection = "[" + value + "]"
		}
		source := `import {Effect as E} from "effect"; export effect function main(){return ` + collection + `}`
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(p.Diagnostics) != 0 {
			Gap(t, "FuzzHeldComputedMethodKey", row.key, "admitted key reports %v", p.Diagnostics)
		}
		runsKey := strings.Contains(p.Text, "$try(") || strings.Contains(p.Text, "$run(E.sync(") || strings.Contains(p.Text, "yield* E.sync(")
		if runsKey == cold || strings.Count(p.Text, "E.sync(") != 1 {
			Gap(t, "FuzzHeldComputedMethodKey", row.key, "computed name must keep one defining-context execution: %s", p.Text)
		}
		js, _, diagnostics := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
		if len(diagnostics) != 0 {
			Gap(t, "FuzzHeldComputedMethodKey", row.key, "executable projection rejects admitted key: %v", diagnostics)
		}
		cmd := exec.CommandContext(t.Context(), "node", "--input-type=module", "--check")
		cmd.Stdin = strings.NewReader(js)
		if output, err := cmd.CombinedOutput(); err != nil {
			Gap(t, "FuzzHeldComputedMethodKey", row.key, "generated JavaScript is invalid: %v\n%s\n%s", err, output, js)
		}

	})
}
