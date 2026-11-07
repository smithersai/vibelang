package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestForkOwnerExplicitTryQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "| `try e` | one Effect, giving its success |")
	chapterSays(t, "002-running.md", "`fork e` evaluates `e` now, on the caller")
}

// A written try in the held operand runs the outer Effect on the caller;
// only the resulting inner Effect runs on the new fiber.
func FuzzForkOwnerExplicitTry(f *testing.F) {
	startShortBudget(f)
	keys := []string{"in", "scoped", "detached"}
	for _, key := range keys {
		for flags := uint8(0); flags < 9; flags++ {
			f.Add(key, flags)
		}
	}
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestForkOwnerExplicitTryQuoted(t)
		operator := "fork.scoped"
		switch key {
		case "in":
			operator = "fork.in(s)"
		case "detached":
			operator = "fork.detached"
		}
		gap := []string{" ", " /* operand */ ", "\t"}[(flags/3)%3]
		operand := fmt.Sprintf("(try%sE.succeed(E.succeed(%d)))", gap, flags%50)
		switch flags % 3 {
		case 0:
			operand = "(" + operand + ")"
		case 1:
			operand = "(" + operand + " as E.Effect<number>)"
		case 2:
			operand = "(" + operand + " satisfies E.Effect<number>)"
		}
		source := `import {Effect as E,Fiber as F,Scope as S} from "effect"; export effect function scenario(s:S.Scope){const f=` + operator + gap + operand + `; return try F.join(f)}`
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(p.Diagnostics) != 0 {
			Gap(t, "FuzzForkOwnerExplicitTry", key, "admitted operand reports %v", p.Diagnostics)
		}
		if !strings.Contains(p.Text, "$try(") || strings.Count(p.Text, "E.succeed(E.succeed(") != 1 {
			Gap(t, "FuzzForkOwnerExplicitTry", key, "written try must remain one execution site inside fork operand: %s", p.Text)
		}
	})
}
