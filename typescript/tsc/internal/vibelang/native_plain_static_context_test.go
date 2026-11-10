package vibelang

import (
	"slices"
	"testing"
)

func TestPlainStaticBlockAwaitContexts(t *testing.T) {
	for _, rule := range []struct {
		name, source string
		want         []string
	}{
		{"plain-reservation", "function fork(){return 1};function join(){return 2};export effect function read(){class Value{static{void(()=>fork()+join())}};return 1}", nil},
		{"static-reservation", "export effect function read(){class Value{static{join(1)}};return 1}", []string{"EK1701"}},
		{"nested-effect", "export class Value{static{void(effect()=>{await 1})}}", []string{"EK102"}},
		{"nested-async", "export class Value{static{void(async()=>{return await Promise.resolve(1)})}}", nil},
		{"nested-async-effect", "export class Value{static{void(async()=>{return await Effect.succeed(1)})}}", []string{"EK103"}},
		{"later-effect", "export effect function read(){class Value{static{void 1}};await 1}", []string{"EK102"}},
		{"later-async", "export async function read(){class Value{static{void 1}};return await Promise.resolve(1)}", nil},
		{"later-module", "class Value{static{void 1}};await Effect.succeed(1)", []string{"EK103"}},
	} {
		t.Run(rule.name, func(t *testing.T) {
			source := "import {Effect} from \"effect\";" + rule.source
			if got := plainStaticAwaitCodes(t, source); !slices.Equal(got, rule.want) {
				t.Fatalf("want %v;got %v\n%s", rule.want, got, source)
			}
		})
	}
}
