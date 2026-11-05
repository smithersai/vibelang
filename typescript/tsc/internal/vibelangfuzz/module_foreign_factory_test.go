package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const moduleForeignFactoryContract = "a type without `@throws` admits only `never`"
const moduleForeignFactoryRule = "No VibeLang rule runs on it, except the three below."

func TestModuleForeignFactoriesQuoted(t *testing.T) {
	for _, quote := range []struct{ chapter, text string }{
		{"003-failures.md", moduleForeignFactoryContract},
		{"001-functions.md", moduleForeignFactoryRule},
	} {
		if !strings.Contains(SpecText(quote.chapter), quote.text) {
			t.Fatalf("%s no longer says %q", quote.chapter, quote.text)
		}
	}
}

func TestModuleForeignFactoryCase(t *testing.T) {
	w := NewWorkspace(t)
	for _, seed := range CaseSeeds() {
		if seed.Name != "http-api-node-server-factory" {
			continue
		}
		result := toolsCompile(t, w, "FuzzModuleForeignFactories", seed.Files)
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("module factory fixture: %s", d.String())
			}
		}
		return
	}
	t.Fatal("missing HTTP module factory acceptance fixture")
}

func FuzzModuleForeignFactories(f *testing.F) {
	startShortBudget(f)
	keys := []string{"direct", "import-alias", "local-alias", "namespace"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	f.Add("key-fallback", uint8(3))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestModuleForeignFactoriesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		imp, factory := "import { make, layer } from \"./sdk.js\"\n", "make"
		switch key {
		case "import-alias":
			imp, factory = "import { make as create, layer } from \"./sdk.js\"\n", "create"
		case "local-alias":
			imp += "const create=make\n"
			factory = "create"
		case "namespace":
			imp, factory = "import * as sdk from \"./sdk.js\"\nconst layer=sdk.layer\n", "sdk.make"
		}
		sdk := "let fail=false\nexport function make(){if(fail)throw new Error(\"create\");return {}}\nexport function layer(create:()=>object, port:number):number{return port}\n"
		for _, adapted := range []bool{false, true} {
			source := imp + "export const Server=layer(" + factory + ",3000)\n"
			if adapted {
				source = "module adapter {\n" + imp + "export function serverLayer(port:number){return layer(" + factory + ",port)}\n}\nimport {serverLayer} from adapter\nexport const Server=serverLayer(3000)\n"
			}
			if variant&1 != 0 {
				source = strings.ReplaceAll(source, "\n", "\r\n")
			}
			if variant&2 != 0 {
				source = "// preserve server adapter comment 🧪\n" + source
			}
			result := toolsCompile(t, w, "FuzzModuleForeignFactories", map[string]string{"main.vibe": source, "sdk.ts": sdk})
			defer result.Remove()
			probe := fmt.Sprintf("feature:%s:%t:%d", key, adapted, variant&3)
			found := false
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if !adapted && IsEK(d) && d.Code() == 402 {
					found = true
					continue
				}
				Gap(t, "FuzzModuleForeignFactories", probe, "unexpected module factory diagnostic: %s\n%s", d.String(), source)
			}
			if !adapted && !found {
				Gap(t, "FuzzModuleForeignFactories", probe, "Chapter 3: %q; unadapted foreign callback was admitted", moduleForeignFactoryContract)
			}
			ExpectPending(t, "FuzzModuleForeignFactories", probe)
		}
	})
}
