package vibelang

import (
	"strings"
	"testing"
)

func TestFixRelicWire(t *testing.T) {
	source := "service A { static readonly key = \"relic/A\"; value: number }\nservice B { static readonly key = \"relic/B\"; value: number }\nconst a=Layer.succeed(A,{value:1}); const b=Layer.succeed(B,{value:2}); export const Live = wire(a,b)"
	result, name, _ := fixOnce(t, source)
	fixed := result.Files[name]
	if result.Err != nil || len(result.Refused) > 0 || fixed == nil || !strings.Contains(fixed.Text, "provideMerge") || strings.Contains(fixed.Text, "wire(a,b)") {
		t.Fatalf("missing explicit Layer composition: %+v fixed %+v", result, fixed)
	}
}

func TestFixRelicWireControls(t *testing.T) {
	for _, source := range []string{
		"export function main(){const wire=(a:number,b:number)=>a+b;return wire(1,2)}",
		"service A {static readonly key=\"relic/Spread/A\";value:number}; const layers=[Layer.succeed(A,{value:1})] as const; export const Live=wire(...layers)",
		"service A {static readonly key=\"relic/Shadow/A\";value:number}; const a=Layer.succeed(A,{value:1}); export function make(){const Layer=0;return {shadow:Layer,live:wire(a)}}",
	} {
		result, _, _ := fixOnce(t, source)
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		for _, file := range result.Files {
			if strings.Contains(file.Text, "$wireLayers") {
				t.Fatalf("changed unresolved or non-intrinsic call: %s", file.Text)
			}
		}
	}
}

func TestFixRelicWireProvideBoundary(t *testing.T) {
	source := "service A {read():number!!}\nservice B {read():number!!}\nconst ALive=Layer.succeed(A,{effect read(){return 7}});\nconst BLive=Layer.effect(B,effect {const a=try A;return {effect read(){return (try a.read())+1}}});\nexport effect function main(){provide wire(ALive,BLive){return try (try B).read()}}"
	result, name, _ := fixOnce(t, source)
	if result.Err != nil || len(result.Refused) > 0 || result.Files[name] == nil || strings.Contains(result.Files[name].Text, "wire(") {
		t.Fatalf("layer method declarations were not safely checked: %+v", result)
	}
}
