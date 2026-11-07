package vibelangfuzz

import (
	"fmt"
	"os/exec"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestTryValueOperandQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "Every operand is evaluated once, left to right as written")
	chapterSays(t, "002-running.md", "Returning an Effect does not itself execute it.")
	chapterSays(t, "002-running.md", "| `try e` | one Effect, giving its success |")
}

func FuzzTryValueOperand(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"as", "satisfies", "conditional"} {
		for flags := uint8(0); flags < 8; flags++ {
			f.Add(key, flags)
		}
	}
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestTryValueOperandQuoted(t)
		call := fmt.Sprintf("E.sync(()=>E.succeed(%d))", flags%31)
		if flags&1 != 0 {
			call = "make()"
		}
		if flags&2 != 0 {
			call = "E.succeed(try " + call + ")"
		}
		operand := call + " as Job"
		switch key {
		case "satisfies":
			operand = call + " satisfies Job"
		case "conditional":
			operand = "true ? " + call + " : E.succeed(E.succeed(99))"
		}
		if flags&4 != 0 {
			operand = "/* operand */ " + operand + " /* end */"
		}
		source := `import {Effect as E} from "effect";type Job=E.Effect<E.Effect<number>>;function make(){return E.sync(()=>E.succeed(7))}export effect function main(){const program=try (` + operand + `);return try program}`
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(p.Diagnostics) != 0 {
			Gap(t, "FuzzTryValueOperand", key, "valid operand reports %v", p.Diagnostics)
		}
		at := strings.Index(p.Text, "const program=")
		if at < 0 {
			t.Fatalf("initializer missing: %s", p.Text)
		}
		end := strings.Index(p.Text[at:], ";return")
		if end < 0 {
			t.Fatalf("return boundary missing: %s", p.Text)
		}
		initializer := p.Text[at : at+end]
		if strings.Contains(initializer, "$run(E.sync(") || strings.Contains(initializer, "$run(make(") {
			Gap(t, "FuzzTryValueOperand", key, "plain construction inside a try operand must not add delegation: %s", p.Text)
		}
		minimum := 1
		if flags&2 != 0 {
			minimum++
		}
		if strings.Count(initializer, "$try(") < minimum {
			Gap(t, "FuzzTryValueOperand", key, "written execution sites were lost: %s", p.Text)
		}
		js, _, diags := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
		if len(diags) != 0 {
			Gap(t, "FuzzTryValueOperand", key, "emit reports %v", diags)
		}
		cmd := exec.CommandContext(t.Context(), "node", "--input-type=module", "--check")
		cmd.Stdin = strings.NewReader(js)
		if out, err := cmd.CombinedOutput(); err != nil {
			Gap(t, "FuzzTryValueOperand", key, "invalid JavaScript: %v\n%s\n%s", err, out, js)
		}
	})
}
