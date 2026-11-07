package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestMapperProducerFieldBoundaryQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", producerMethodLoweringQuote)
}

// VIP-21 gives effect generator methods TypeScript's async generator method
// grammar. Blanking the marker must not let * continue a preceding field.
func FuzzMapperProducerFieldBoundary(f *testing.F) {
	startShortBudget(f)
	keys := []string{"false", "zero", "negative", "string", "array", "object", "null", "regexp"}
	initializers := []string{"false", "0", "-1", "'field'", "[]", "({n:1})", "null", "/field/"}
	for _, key := range keys {
		for variant := uint8(0); variant < 8; variant++ {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestMapperProducerFieldBoundaryQuoted(t)
		choice := -1
		for i, k := range keys {
			if k == key {
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
		initializer := initializers[choice]
		trivia := []string{"\n", "\r\n", "\n// next member\n", "\n/* next member */\n"}[variant%4]
		modifier := []string{"", "public ", "static ", "private "}[variant/4%4]
		source := "class Feed { marker=" + initializer + trivia + modifier + "effect *values() { yield this.marker } }"
		for _, mode := range []string{"checking", "lint", "execution"} {
			ctx := vibelangmapper.FileContext{Lint: mode == "lint"}
			var got vibelangmapper.Projection
			if mode == "execution" {
				got = vibelangmapper.Executable(source, ctx)
			} else {
				got = vibelangmapper.Project(source, ctx)
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/field.ts")}, got.Text, core.ScriptKindTS)
			var field, method bool
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if n.Kind == ast.KindPropertyDeclaration && n.Name().Text() == "marker" && n.Initializer() != nil {
					init := n.Initializer()
					field = strings.TrimSpace(got.Text[init.Pos():init.End()]) == initializer
				}
				if n.Kind == ast.KindMethodDeclaration && n.Name().Text() == "values" {
					method = true
				}
				return n.ForEachChild(visit)
			}
			visit(file.AsNode())
			if len(got.Diagnostics) != 0 || len(file.Diagnostics()) != 0 || !field || !method || !strings.Contains(got.Text, "return $produce(") {
				Gap(t, "FuzzMapperProducerFieldBoundary", key, "%s: %s; field=%t method=%t mapper=%v syntax=%v\n%s", mode, producerMethodLoweringQuote, field, method, got.Diagnostics, file.Diagnostics(), got.Text)
			}
		}
		ExpectPending(t, "FuzzMapperProducerFieldBoundary", key)
		ExpectPending(t, "FuzzMapperProducerFieldBoundary", specCorpusKey(t))
	})
}
