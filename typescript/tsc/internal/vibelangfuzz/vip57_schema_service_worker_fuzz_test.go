package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

type vip57BadMember struct {
	member string
	codes  []string
}

var vip57BadMembers = []vip57BadMember{
	{"readonly value: number", []string{"EK5701"}},
	{"get value(): number", []string{"EK5701"}},
	{"static readonly defaultValue = () => ({})", []string{"EK5701"}},
	{"load<T>(id: T): number!!", []string{"EK5701"}},
	{"load(id: number): number", []string{"EK5701"}},
	{"load(id: number): Aliased", []string{"EK5701"}},
	{"load(id: number): number!!Clock", []string{"EK5701"}},
	{"load(...ids: number[]): number!!", []string{"EK5701"}},
	{"load({ id }: { id: number }): number!!", []string{"EK5701"}},
	{"load(id: number): number!!; load(id: string): number!!", []string{"EK5701", "EK5701"}},
	{"load(id: () => number): number!!", []string{"EK2109"}},
	{"load(id: number): Stream<Opaque>", []string{"EK2109"}},
	{"private load(id: number): number!!", []string{"EK0902"}},
}

func FuzzVIP57SchemaServiceWorker(f *testing.F) {
	startShortBudget(f)
	for variant := range 5 + len(vip57BadMembers) {
		f.Add(uint8(0), uint8(variant), uint16(variant), variant%2 != 0)
	}
	for variant := range 10 {
		f.Add(uint8(1), uint8(variant), uint16(variant), variant%2 != 0)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, family, variant uint8, id uint16, optional bool) {
		method := fmt.Sprintf("lookup%d", id)
		service := fmt.Sprintf("Store%d", id)
		if family%2 == 0 {
			row := int(variant) % (5 + len(vip57BadMembers))
			var member, rpc string
			var want []string
			switch row {
			case 0, 1, 2, 3:
				parameter, payload := "value: number", "value: Schema.Number"
				if optional {
					parameter, payload = "value?: number", "value: Schema.optional(Schema.Number)"
				}
				channel := []string{"number!Gone", "Effect.Effect<number, Gone>", "Stream<number, Gone>", "Stream.Stream<number, Gone>"}[row]
				member = fmt.Sprintf("%s(%s): %s", method, parameter, channel)
				rpc = fmt.Sprintf(`Rpc.make("%s", { payload: { %s }, success: Schema.Number, error: Gone`, method, payload)
				if row >= 2 {
					rpc += ", stream: true"
				}
				rpc += " })"
			case 4:
				member = "reset(): void!!"
				rpc = `Rpc.make("reset", { payload: {} })`
			default:
				bad := vip57BadMembers[row-5]
				member, want = bad.member, bad.codes
			}
			source := "schema error Gone {}\ninterface Opaque { x: number }\ntype Aliased = number!!\n" +
				fmt.Sprintf("export schema service %s {\n  %s\n}\nexport const witness = %d\n", service, member, id)
			r := vipCompile(t, w, builtinsProject(map[string]string{"main.vibe": source, "package.json": `{"name":"vip57","type":"module"}`}))
			vipDiagnostics(t, r, want...)
			if rpc != "" {
				js, dts := r.Outputs["out/main.js"], r.Outputs["out/main.d.ts"]
				if strings.Count(js, rpc) != 1 || strings.Count(js, "Rpc.make(") != 1 ||
					!strings.Contains(js, service+"Rpcs extends RpcGroup.make(") ||
					!strings.Contains(dts, "class "+service+" extends") {
					t.Fatalf("expected one RPC %q and service contract %s\nJS: %s\nDTS: %s", rpc, service, js, dts)
				}
			}
			return
		}

		contract := fmt.Sprintf("export schema service %s { %s(value: number): number!! }\n", service, method)
		layer := fmt.Sprintf("Layer.succeed(%s, { %s: effect (value) => value + %d })", service, method, id)
		path := fmt.Sprintf("./store%d.vibe", id)
		attribute := ` with { type: "worker" }`
		binding := "worker"
		implementation := contract + "export default " + layer
		follow := fmt.Sprintf("\nimport type { %s } from %q\nexport const handle: Experimental.Rpc.WorkerHandle<Layer.Layer<%s>> = worker\n", service, path, service)
		var want []string
		switch variant % 10 {
		case 0:
		case 1:
			binding, follow, want = "{ "+service+" }", "", []string{"EK5703"}
		case 2:
			binding, follow, want = "* as worker", "", []string{"EK5703"}
		case 3:
			binding, follow, want = "worker, { "+service+" }", "", []string{"EK5703"}
		case 4:
			binding, follow, want = "", "", []string{"EK5703"}
		case 5:
			implementation, follow, want = contract+"export const live = "+layer, "", []string{"EK5702"}
		case 6:
			implementation, follow, want = "export default 42", "", []string{"EK5702"}
		case 7:
			implementation, follow, want = strings.Replace(implementation, "schema service", "service", 1), "", []string{"EK5702"}
		case 8:
			implementation, follow, want = strings.TrimPrefix(implementation, "export "), "", []string{"EK5702"}
		case 9:
			attribute = ""
			follow = "\nexport const live = worker\n"
		}
		head := "import "
		if binding != "" {
			head += binding + " from "
		}
		main := head + fmt.Sprintf("%q", path) + attribute + follow
		project := builtinsProject(map[string]string{
			"main.vibe": main, path[2:]: implementation,
			"package.json": `{"name":"vip57","type":"module"}`,
		})
		project.Config = strings.Replace(project.Config, `"strict": true`, `"strict": true, "rewriteRelativeImportExtensions": true`, 1)
		r := vipCompile(t, w, project)
		vipDiagnostics(t, r, want...)
		js := r.Outputs["out/main.js"]
		switch variant % 10 {
		case 0:
			handle := fmt.Sprintf(`.$worker(new URL("./store%d.js", import.meta.url), [worker$%s])`, id, service)
			if strings.Count(js, handle) != 1 || strings.Contains(js, attribute) {
				t.Fatalf("worker must lower once to a URL plus its imported service: %s", js)
			}
		case 9:
			if !strings.Contains(js, fmt.Sprintf(`import worker from "./store%d.js"`, id)) || strings.Contains(js, ".$worker(") {
				t.Fatalf("ordinary import must preserve the original default binding: %s", js)
			}
		}
	})
}
