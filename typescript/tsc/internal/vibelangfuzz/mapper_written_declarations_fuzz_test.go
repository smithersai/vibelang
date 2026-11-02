package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const mapperWrittenDeclarationQuote = "A function's kind is decided by a keyword on the function, never by its body or by a type."

func TestMapperWrittenDeclarationQuoted(t *testing.T) { requireMapperWrittenDeclarationQuote(t) }

func requireMapperWrittenDeclarationQuote(t testing.TB) {
	t.Helper()
	spec, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(spec), mapperWrittenDeclarationQuote) {
		t.Fatal("chapter 1 no longer states the written-kind rule")
	}
}

func FuzzMapperWrittenEffectDeclarations(f *testing.F) {
	startShortBudget(f)
	requireMapperWrittenDeclarationQuote(f)
	for kind := 0; kind < 5; kind++ {
		for annotation := 0; annotation < 3; annotation++ {
			f.Add(fmt.Sprintf("%d/%d", kind, annotation))
		}
	}
	f.Fuzz(func(t *testing.T, key string) {
		var hash uint64
		for i, b := range []byte(key) {
			hash = hash*33 + uint64(b) + uint64(i)
		}
		var kind, annotation int
		if n, _ := fmt.Sscanf(key, "%d/%d", &kind, &annotation); n != 2 || kind < 0 || kind >= 5 || annotation < 0 || annotation >= 3 {
			kind, annotation = int(hash%5), int((hash/5)%3)
		}
		prefix, result := "", ""
		switch annotation {
		case 1:
			prefix, result = "type Result = number!!;\n", ": Result"
		case 2:
			prefix, result = "import type { Result } from './host.js';\n", ": Result"
		}
		source := ""
		switch kind {
		case 0:
			source = "effect function run()" + result + " { return 7 }"
		case 1:
			source = "export default effect function ()" + result + " { return 7 }"
		case 2:
			source = "class Example { effect run()" + result + " { return 7 } }"
		case 3:
			source = "class Example { static effect run()" + result + " { return 7 } }"
		case 4:
			source = "class Example { effect #run()" + result + " { return 7 } }"
		}
		source = prefix + source
		neighbors := []string{
			"class Unrelated { static { const value = 1 } };\n",
			"try {} catch (error) {}\n",
			"while (false) { break }\n",
			"",
		}
		source = neighbors[hash%uint64(len(neighbors))] + source
		projected := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if got := strings.Count(projected.Text, "function*"); got != 1 {
			Gap(t, "FuzzMapperWrittenEffectDeclarations", "written:"+key,
				"VIP-1: %s; want one generator, got %d:\n%s\n%s", mapperWrittenDeclarationQuote, got, source, projected.Text)
		}
		plain := vibelangmapper.Project("function ordinary(): number { return 7 }; class Plain { run(): number { return 8 } }", vibelangmapper.FileContext{})
		if strings.Contains(plain.Text, "function*") {
			Gap(t, "FuzzMapperWrittenEffectDeclarations", "plain-control", "plain declarations became generators:\n%s", plain.Text)
		}
		ExpectPending(t, "FuzzMapperWrittenEffectDeclarations", specCorpusKey(t))
	})
}
