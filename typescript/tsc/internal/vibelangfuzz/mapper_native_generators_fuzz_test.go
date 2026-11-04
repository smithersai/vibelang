package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const mapperNativeGeneratorsQuote = "A plain `function*` stays a JavaScript generator."

func requireMapperNativeGeneratorsQuote(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("002-running.md"), mapperNativeGeneratorsQuote) {
		t.Fatal("native generator rule changed")
	}
}

func TestMapperNativeGeneratorsQuoted(t *testing.T) { requireMapperNativeGeneratorsQuote(t) }

// VIP-21 gives the oracle: mapping ordinary generator code keeps its native
// body. Nearby Effect code may transform, but cannot take over that body.
func FuzzMapperNativeGenerators(f *testing.F) {
	startShortBudget(f)
	requireMapperNativeGeneratorsQuote(f)
	keys := []string{"declaration", "expression", "method", "async", "delegation", "annotated", "class", "mixed"}
	for _, key := range keys {
		for variant := uint8(0); variant < 4; variant++ {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		choice := -1
		for i, candidate := range keys {
			if key == candidate {
				choice = i
				break
			}
		}
		if choice < 0 {
			if key == "" {
				return
			}
			choice = int(key[0]) % len(keys)
		}
		key = keys[choice]
		name, call := fmt.Sprintf("values%d", variant), fmt.Sprintf("read%d()", variant)
		var native string
		switch key {
		case "declaration", "mixed":
			native = "function* " + name + "() { yield " + call + " }\n"
		case "expression":
			native = "const values = function* " + name + "() { yield " + call + " }\n"
		case "method":
			native = "const holder = { *" + name + "() { yield " + call + " } }\n"
		case "async":
			native = "async function* " + name + "() { yield await " + call + " }\n"
		case "delegation":
			native = fmt.Sprintf("function* %s() { yield* [%d, %d] }\n", name, variant, int(variant)+1)
		case "annotated":
			native = "function* " + name + "(): Generator<number, string, boolean> { const ready = yield 1; return String(ready) }\n"
		case "class":
			native = "class Holder { *" + name + "() { yield " + call + " } }\n"
		}
		prefix := []string{"", "// native generator\n", "/* native generator */\n", "\n"}[variant%4]
		source := prefix + native
		if key == "mixed" {
			source += "effect function sibling() { return 1 }\n"
		}
		projected := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(projected.Diagnostics) != 0 {
			Gap(t, "FuzzMapperNativeGenerators", key, "native generator projection has diagnostics: %v", projected.Diagnostics)
		}
		line, body, found := strings.Cut(projected.Text, "\n")
		if !found || !strings.HasPrefix(line, "import {") {
			Gap(t, "FuzzMapperNativeGenerators", key, "checking projection lost its import prelude: %q", line)
		}
		if key == "mixed" {
			if !strings.Contains(body, prefix+native) {
				Gap(t, "FuzzMapperNativeGenerators", key, "nearby Effect code changed the native generator: %s", body)
			}
		} else if body != source {
			Gap(t, "FuzzMapperNativeGenerators", key, "%s\nsource: %s\nprojection: %s", mapperNativeGeneratorsQuote, source, body)
		}
		ExpectPending(t, "FuzzMapperNativeGenerators", key)
	})
}
