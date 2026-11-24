package vibelangfuzz

import (
	"fmt"
	"os"
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
	node := newMapperTryNode(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestTryValueOperandQuoted(t)
		value := flags % 31
		call := fmt.Sprintf("E.sync(()=>{ev('outer');return inner(%d)})", value)
		if flags&1 != 0 {
			call = "make()"
			value = 7
		}
		if flags&2 != 0 {
			call = "E.succeed(try " + call + ")"
		}
		operand := call + " as Job"
		switch key {
		case "satisfies":
			operand = call + " satisfies Job"
		case "conditional":
			operand = "true ? " + call + " : E.succeed(inner(99))"
		}
		if flags&4 != 0 {
			operand = "/* operand */ " + operand + " /* end */"
		}
		source := `import {Effect as E} from "effect";import {ev} from "vip-events";type Job=E.Effect<E.Effect<number>>;function inner(n:number){return E.sync(()=>{ev("inner");return n})}function make(){ev("make");return E.sync(()=>{ev("outer");return inner(7)})}export effect function main(){const program=try (` + operand + `);ev("between");return try program}`
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(p.Diagnostics) != 0 {
			Gap(t, "FuzzTryValueOperand", key, "valid operand reports %v", p.Diagnostics)
		}
		js, _, diags := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
		if len(diags) != 0 {
			Gap(t, "FuzzTryValueOperand", key, "emit reports %v", diags)
		}
		trace := ""
		if flags&1 != 0 {
			trace = "ev('make');"
		}
		reference := fmt.Sprintf("export const main=()=>E.gen(function*(){%s ev('outer'); ev('between'); return yield* E.sync(()=>{ev('inner');return %d});});", trace, value)
		checkMapperTryExecution(t, node, "FuzzTryValueOperand", key, js, reference)
	})
}

func newMapperTryNode(f *testing.F) *Node {
	f.Helper()
	w := NewWorkspace(f)
	if err := installVIPEvents(w); err != nil {
		f.Fatal(err)
	}
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(f, "node is required: %v", err)
	}
	f.Cleanup(node.Close)
	return node
}

func checkMapperTryExecution(t *testing.T, node *Node, target, key, js, reference string) {
	t.Helper()
	dir, err := os.MkdirTemp(node.dir, "mapper-try-")
	if err != nil {
		t.Fatal(err)
	}
	project := &Result{
		Dir: dir,
		Outputs: map[string]string{
			"main.mjs": js,
			"ref.mjs":  "import {Effect as E} from 'effect';import {ev} from 'vip-events';" + reference,
		},
	}
	t.Cleanup(project.Remove)
	want := node.RunVIP(project, "ref.mjs")
	if want.Kind != "exit" {
		t.Fatalf("invalid Effect reference: %s", want.Log)
	}
	got := node.RunVIP(project, "main.mjs")
	if aspect, diff := VIPCompare(want, got); aspect != "" {
		Gap(t, target, key, "emitted program differs in %s: %s", aspect, diff)
	}
}
