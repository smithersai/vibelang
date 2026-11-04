package vibelang

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestFixNothrowRefusesPolymorphicAPI(t *testing.T) {
	for _, source := range []string{
		"import type {Reader} from \"./native.js\";export const f=<T extends Reader>(r:T):infer _=>r.read()",
		"import type {Reader} from \"./native.js\";export const f=<T extends Reader>(r:T&{meta?:string}):infer _=>r.read()",
		"import type {Reader} from \"./native.js\";export const f=<T extends {reader:Reader}>(r:T[\"reader\"]):infer _=>r.read()",
		"import type {Reader} from \"./native.js\";export function outer<T extends Reader>(r:T){return ():infer _=>r.read()}",
	} {
		_, file, _, _ := editorProgram(t, source)
		writeNothrowNativeFixture(t, filepath.Dir(file.FileName().AsString()))
		result := fixCase(t, filepath.Dir(file.FileName().AsString()))
		if result.Err != nil || len(result.Sites) == 0 || len(result.Changed) != 0 {
			t.Fatalf("missing API-preserving refusal: %+v", result)
		}
		fixed := source
		if f := result.Files[file.FileName()]; f != nil {
			fixed = f.Text
		}
		if strings.Contains(fixed, "$invoke(") {
			t.Fatalf("deferred ReturnType changes the public signature: %s", fixed)
		}
		for _, site := range result.Sites {
			if !SiteHolds(source, fixed, site) {
				t.Fatalf("refused site changed: %+v", site)
			}
		}
	}
}
