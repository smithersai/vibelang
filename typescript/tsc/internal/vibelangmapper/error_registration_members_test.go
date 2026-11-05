package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlainErrorRegistrationKeepsNativeStaticBlock(t *testing.T) {
	source := `const events:number[]=[];
class NativeControl { static { events.push(7) } }
error Sample {value:number;get label():number{return this.value}}
export function scenario():{tag:string;value:number;events:number[]} {
 const value=new Sample({value:3});
 return {tag:value._tag,value:value.label,events};
}
`
	for name, p := range map[string]Projection{"checking": Project(source, testContext), "executable": Executable(source, testContext)} {
		if len(p.Diagnostics) != 0 {
			t.Fatalf("%s: %v", name, p.Diagnostics)
		}
		if !strings.Contains(p.Text, "static { events.push(7) }") {
			t.Fatalf("%s lost the authored static block", name)
		}
		assertValidMap(t, p, source)
	}
	js, _, ds := Emit(source, testContext)
	if len(ds) != 0 {
		t.Fatal(ds)
	}
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	cmd := exec.Command("node", "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nconsole.log(JSON.stringify(scenario()))")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s\n%s", err, out, js)
	}
	if strings.TrimSpace(string(out)) != `{"tag":"Sample","value":3,"events":[7]}` {
		t.Fatalf("unexpected result: %s", out)
	}
}
