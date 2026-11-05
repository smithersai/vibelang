package vibelangmapper

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBindingFreePatternIteratorCleanup(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, test := range []struct{ name, source, invoke, want string }{
		{"empty", "export function pick(subject:unknown):boolean{return subject is []}", "pick(input([1]))", `[false,["open","next","close"]]`},
		{"literal", "export function pick(subject:unknown):boolean{return subject is [1]}", "pick(input([1,2]))", `[false,["open","next","next","close"]]`},
		{"empty-success", "export function pick(subject:unknown):boolean{return subject is []}", "pick(input([]))", `[true,["open","next"]]`},
		{"getter", "export function pick(holder:{readonly value:unknown}):boolean{return holder.value is []}", "pick({get value(){events.push('get');return input([1])}})", `[false,["get","open","next","close"]]`},
	} {
		t.Run(test.name, func(t *testing.T) {
			js, _, ds := Emit(test.source, testContext)
			if len(ds) != 0 {
				t.Fatal(ds)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "node", "--no-warnings", "--input-type=module")
			cmd.Dir = scope
			runner := `
const events = [];
function input(values) {
  return {
    [Symbol.iterator]() {
      events.push("open");
      let index = 0;
      return {
        next() {
          events.push("next");
          return index < values.length ? {done:false, value:values[index++]} : {done:true};
        },
        return() {
          events.push("close");
          return {done:true};
        }
      };
    }
  };
}
console.log(JSON.stringify([` + test.invoke + `, events]));
`
			assertParses(t, js+runner)
			cmd.Stdin = strings.NewReader(js + runner)
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("%v\n%s\n%s", err, out, js)
			}
			if strings.TrimSpace(string(out)) != test.want {
				t.Fatalf("got %s want %s", out, test.want)
			}
		})
	}
}
