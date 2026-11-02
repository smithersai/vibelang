package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const mapperWrittenEffectQuote = "A function's kind is decided by a keyword on the function, never by its body or by a type."

func TestMapperWrittenEffectQuoted(t *testing.T) { requireMapperWrittenEffectQuote(t) }

func requireMapperWrittenEffectQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), mapperWrittenEffectQuote) {
		t.Fatalf("chapter 1 no longer says %q", mapperWrittenEffectQuote)
	}
}

// A written effect lambda keeps its kind at each native callback destination.
// The projection must also retain its generator after keyword normalization.
func FuzzMapperWrittenEffectModifiers(f *testing.F) {
	startShortBudget(f)
	requireMapperWrittenEffectQuote(f)
	kinds := []string{"arrow", "function", "method", "nested"}
	contexts := []string{"void", "unknown", "any", "Function", "effect"}
	homes := []string{"direct", "array", "property", "argument"}
	for _, kind := range kinds[:3] {
		for _, context := range contexts {
			for _, home := range homes {
				for _, arity := range []string{"0", "1"} {
					f.Add(kind + "/" + context + "/" + home + "/" + arity)
				}
			}
		}
	}
	f.Add("nested/unknown/direct/0")
	table, err := vibelangmapper.DefaultTable()
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string) {
		parts := strings.Split(key, "/")
		if len(parts) != 4 || !slices.Contains(kinds, parts[0]) || !slices.Contains(contexts, parts[1]) ||
			!slices.Contains(homes, parts[2]) || !slices.Contains([]string{"0", "1"}, parts[3]) {
			var choice uint64
			for i, b := range []byte(key) {
				choice = choice*33 + uint64(b) + uint64(i)
			}
			parts = []string{kinds[choice%4], contexts[(choice/4)%5], homes[(choice/20)%4], fmt.Sprint((choice / 80) % 2)}
			key = strings.Join(parts, "/")
		}
		kind, context, home, arity := parts[0], parts[1], parts[2], parts[3]
		params := ""
		if arity == "1" {
			params = "n: number"
		}
		target := "(" + params + ") => " + context
		switch context {
		case "Function":
			target = "Function"
		case "effect":
			target = "(" + params + ") => Effect.Effect<number>"
		}
		prefix := "effect "
		if arity == "1" {
			prefix += "/*kept*/ "
		}
		value := prefix + "(" + params + ") => 7"
		if kind == "function" {
			value = prefix + "function build(" + params + ") { return 7 }"
		}
		if kind == "method" {
			value = "{ " + prefix + "run(" + params + ") { return 7 } }"
			target = "{ run: " + target + " }"
		}
		source := "type Target = " + target + ";\n"
		switch home {
		case "direct":
			source += "const value: Target = " + value
		case "array":
			source += "const value: ReadonlyArray<Target> = [" + value + "]"
		case "property":
			source += "const value: {member: Target} = {member: " + value + "}"
		case "argument":
			source += "declare function take(f: Target): void;\ntake(" + value + ")"
		}
		want := 1
		if kind == "nested" {
			source = "const value: () => unknown = effect () => effect () => 7"
			want = 2
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{
			FileName: tspath.RootedFilePathFromAbsolute("/mapper-keyword.vibe"),
		}, source, core.ScriptKindTS)
		resolver := vibelangmapper.NewResolver(file, table)
		count := 0
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if n.Flags&ast.NodeFlagsVibeLangEffect != 0 && ast.IsFunctionLike(n) {
				count++
				if decision := resolver.Lambda(n); decision.Form != vibelangmapper.FormEffectFn {
					Gap(t, "FuzzMapperWrittenEffectModifiers", "keyword:"+key,
						"VIP-1: %s; resolver returned %s (%s).\n%s", mapperWrittenEffectQuote, decision.Form, decision.Provenance, source)
				}
			}
			n.ForEachChild(visit)
			return false
		}
		file.AsNode().ForEachChild(visit)
		if count != want {
			t.Fatalf("source has %d written lambdas, want %d:\n%s", count, want, source)
		}
		projection := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if !strings.Contains(projection.Text, "function*") {
			Gap(t, "FuzzMapperWrittenEffectModifiers", "projection:"+key,
				"VIP-1: %s; projection erased the Effect generator.\nsource:\n%s\nprojected:\n%s",
				mapperWrittenEffectQuote, source, projection.Text)
		}
		for _, d := range projection.Diagnostics {
			if d.Code == vibelangmapper.CodeFormChoice || d.Code == vibelangmapper.CodeUnprojectedForm {
				Gap(t, "FuzzMapperWrittenEffectModifiers", "choice:"+key,
					"written effect decides the kind without a form choice: %+v\n%s", d, source)
			}
		}
		// A plain void callback remains plain; a marker on a different
		// source function must not leak through the reparse.
		plain := vibelangmapper.Project("const plain: () => void = () => 7", vibelangmapper.FileContext{})
		if strings.Contains(plain.Text, "function*") {
			Gap(t, "FuzzMapperWrittenEffectModifiers", "plain-control", "unmarked void callback became an Effect generator: %s", plain.Text)
		}
		ExpectPending(t, "FuzzMapperWrittenEffectModifiers", specCorpusKey(t))
	})
}
