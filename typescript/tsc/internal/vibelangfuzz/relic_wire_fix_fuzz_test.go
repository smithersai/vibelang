package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

func FuzzRelicWireFix(f *testing.F) {
	startShortBudget(f)
	if !testing.Short() {
		for _, key := range []string{"source-order", "dependency-order", "alias", "namespace", "single", "import-only", "layer-method", "provide-header"} {
			f.Add(key, byte(7))
		}
	}
	w := NewWorkspace(f)
	var node *Node
	f.Cleanup(func() {
		if node != nil {
			node.Close()
		}
	})
	f.Fuzz(func(t *testing.T, key string, n byte) {
		if key == "layer-method" {
			source := fmt.Sprintf("service A {static readonly key=\"relic/WireMethod/A\";read():number!!}\nservice B {static readonly key=\"relic/WireMethod/B\";read():number!!}\nconst ALive=Layer.succeed(A,{effect read(){return %d}});\nconst BLive=Layer.effect(B,effect {const a=try A;return {effect read(){return (try a.read())+1}}});\nexport effect function main(){provide wire(ALive,BLive){return try (try B).read()}}", n)
			checkRelicMigration(t, w, &node, "FuzzRelicWireFix", key, source, "absent:wire(")
			return
		}
		imports, callee, args := "", "wire", "makeA(), makeB()"
		switch key {
		case "import-only", "provide-header":
		case "single":
			args = "makeA()"
		case "dependency-order":
			args = "makeB(), makeA()"
		case "alias":
			imports = "import {wire as compose} from \"vibelang-runtime\"\n"
			callee = "compose"
		case "namespace":
			imports = "import * as Runtime from \"vibelang-runtime\"\n"
			callee = "Runtime.wire"
		default:
			key = "source-order"
		}
		source := imports + fmt.Sprintf("service A { static readonly key=\"relic/Wire/A\"; value:number }\nservice B { static readonly key=\"relic/Wire/B\"; value:number }\nconst events:string[]=[]; function makeA(){events.push(\"factory-A\"); return Layer.succeed(A,{value:%d})}\nfunction makeB(){events.push(\"factory-B\"); return Layer.effect(B,effect { events.push(\"build-B\"); return {value:(try A).value + 1} })}\nexport const Live=%s(%s);\nexport effect function main(){provide Live {return {a:(try A).value,b:(try B).value,events}}}", n, callee, args)
		if key == "provide-header" {
			source = strings.Replace(source, fmt.Sprintf("export const Live=%s(%s);\n", callee, args), "", 1)
			source = strings.Replace(source, "provide Live {", "provide "+callee+"("+args+") {", 1)
		}
		if key == "single" {
			source = strings.Replace(source, "b:(try B).value,", "", 1)
		}
		if key == "import-only" {
			foreign := fmt.Sprintf("import {Context,Layer} from \"effect\";\nexport class A extends Context.Service<A,{value:number}>()(\"relic/Foreign/A\"){}\nexport class B extends Context.Service<B,{value:number}>()(\"relic/Foreign/B\"){}\nexport const events:string[]=[];export function makeA(){events.push(\"factory-A\");return Layer.succeed(A,{value:%d})}export function makeB(){events.push(\"factory-B\");return Layer.succeed(B,{value:%d})}", n, int(n)+1)
			source = "import {A,B,makeA,makeB,events} from \"./foreign.js\";export const Live=wire(makeA(),makeB());export effect function main(){provide Live{return {a:(try A).value,b:(try B).value,events}}}"
			checkRelicMigrationFiles(t, w, &node, "FuzzRelicWireFix", key, map[string]string{"main.vibe": source, "foreign.ts": foreign}, "absent:wire(")
			return
		}
		wanted := "absent:" + callee + "("
		checkRelicMigration(t, w, &node, "FuzzRelicWireFix", key, source, wanted)
	})
}
