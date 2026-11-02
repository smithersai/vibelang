package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWrittenEffectDeclarationRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	source := `
let runs = 0
type Result = number!!
export effect function named(): Result { runs++; return 7 }
export class Tasks {
 effect instance() { runs++; return 8 }
 static effect staticRead(): Result { runs++; return 9 }
 effect #privateRead(): Result { runs++; return 10 }
 effect readPrivate() { return try this.#privateRead() }
}
export function count(): number { return runs }
`
	js, _, diagnostics := Emit(source, testContext)
	if len(diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %v\n%s", diagnostics, js)
	}
	// This is the Effect TypeScript counterpart with erased annotations.
	counterpart := `
let runs = 0
function named() { return NativeEffect.gen(function* () { runs++; return 7 }) }
class Tasks {
 instance() { return NativeEffect.gen(function* () { runs++; return 8 }) }
 static staticRead() { return NativeEffect.gen(function* () { runs++; return 9 }) }
 #privateRead() { return NativeEffect.gen(function* () { runs++; return 10 }) }
 readPrivate() { const self = this; return NativeEffect.gen(function* () { return yield* self.#privateRead() }) }
}
function count() { return runs }
`
	runner := `
import * as NativeEffect from "effect/Effect"
const task = new Tasks()
const programs = [named(), task.instance(), Tasks.staticRead(), task.readPrivate()]
const before = count()
const values = await NativeEffect.runPromise(NativeEffect.all(programs))
console.log(JSON.stringify({ before, values, after: count() }))
`
	var outputs []string
	for _, program := range []string{js, counterpart} {
		cmd := exec.Command(node, "--no-warnings", "--input-type=module")
		cmd.Dir = scope
		cmd.Stdin = strings.NewReader(program + "\n" + runner)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v\n%s\n%s", err, out, program)
		}
		outputs = append(outputs, strings.TrimSpace(string(out)))
	}
	if outputs[0] != outputs[1] || outputs[0] != `{"before":0,"values":[7,8,9,10],"after":4}` {
		t.Fatalf("projection %s; Effect counterpart %s", outputs[0], outputs[1])
	}
}
