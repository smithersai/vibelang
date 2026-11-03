package vibelangfuzz

import (
	"maps"
	"strings"
	"testing"
)

// This two-module witness exercises the complete-output adapter used by the
// migration/data/Effect.fn oracles. The old byte predicates reject it.
func TestDeclarationOutputOracleAPIIdentity(t *testing.T) {
	before := map[string]string{
		"out/main.d.ts":  "export { value } from './other.ts';\n/** shape */\nexport type Shape = { b: number; a: string };",
		"out/other.d.ts": "export declare const value: string;",
	}
	after := map[string]string{
		"out/main.d.ts":  "export {value} from \"./other.js\";\n/** shape */\nexport type Shape={a:string;b:number}",
		"out/other.d.ts": "export declare const value : string",
	}
	if maps.Equal(before, after) {
		t.Fatal("witness must differ under the retired byte gate")
	}
	if diff := compareDeclarationOutputs(t, before, after); diff != "" {
		t.Fatalf("harmless output rewrites:\n%s", diff)
	}
	for _, tc := range []struct{ name, source, diagnostic string }{
		{"type", strings.Replace(after["out/main.d.ts"], "a:string", "a:boolean", 1), "TS2344"},
		{"name", strings.Replace(after["out/main.d.ts"], "type Shape", "type Renamed", 1), "Name differences"},
		{"docs", strings.Replace(after["out/main.d.ts"], "/** shape */", "/** changed */", 1), "Doc-comment differences"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			changed := maps.Clone(after)
			changed["out/main.d.ts"] = tc.source
			if diff := compareDeclarationOutputs(t, before, changed); !strings.Contains(diff, tc.diagnostic) {
				t.Fatalf("missing %s diagnostic:\n%s", tc.diagnostic, diff)
			}
		})
	}
}
