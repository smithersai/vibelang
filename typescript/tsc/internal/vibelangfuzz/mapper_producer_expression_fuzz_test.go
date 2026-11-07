package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const mapperProducerExpressionGrammarQuote = "`effect` goes exactly where TypeScript allows `async`, and nowhere else (VIP-1)"

const mapperProducerExpressionQuote = "`effect function*` returns a Stream, as `async function*` returns an AsyncIterable."

func requireMapperProducerExpressionQuote(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("001-functions.md"), mapperProducerExpressionGrammarQuote) {
		t.Fatal("producer expression grammar changed")
	}
	if !strings.Contains(SpecText("002-running.md"), mapperProducerExpressionQuote) {
		t.Fatal("producer expression rule changed")
	}
}
func TestMapperProducerExpressionQuoted(t *testing.T) { requireMapperProducerExpressionQuote(t) }

// VIP-21 selects the Stream protocol by the written effect marker. Vary both
// expression containers and trivia; nearby native generators keep their protocol.
func FuzzMapperProducerExpression(f *testing.F) {
	startShortBudget(f)
	requireMapperProducerExpressionQuote(f)
	keys := []string{"anonymous", "named", "parenthesized", "property", "array", "default", "rest", "generic"}
	for _, key := range keys {
		for variant := uint8(0); variant < 4; variant++ {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		choice := -1
		for i, k := range keys {
			if key == k {
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
		// Like async, effect and function stay on the same line.
		trivia := []string{" ", " /* producer */ ", "\t", " /**/ /* producer */ "}[variant%4]
		header := "function*"
		suffix := "()"
		switch key {
		case "named":
			header += " items"
		case "default":
			suffix = "(value=1)"
		case "rest":
			suffix = "(...values:number[])"
		case "generic":
			header += " <T>"
			suffix = "(value:T)"
		}
		expression := "effect" + trivia + header + suffix + fmt.Sprintf(" { yield %d; try Effect.void; yield %d }", variant, int(variant)+1)
		source := "const values=" + expression
		switch key {
		case "parenthesized":
			source = "const values=(" + expression + ")"
		case "property":
			source = "const holder={values:" + expression + "}"
		case "array":
			source = "const values=[" + expression + "]"
		}
		source = "import {Effect} from \"effect\";\n" + source + ";\nconst native=function* () { yield 999 };"
		for _, mode := range []string{"checking", "lint", "execution"} {
			ctx := vibelangmapper.FileContext{Lint: mode == "lint"}
			var projection vibelangmapper.Projection
			if mode == "execution" {
				projection = vibelangmapper.Executable(source, ctx)
			} else {
				projection = vibelangmapper.Project(source, ctx)
			}
			if len(projection.Diagnostics) != 0 || strings.Count(projection.Text, "return $produce(") != 1 || !strings.Contains(projection.Text, "const native=function* () { yield 999 }") {
				Gap(t, "FuzzMapperProducerExpression", key, "%s: %s; expected one cold producer and one native generator, diagnostics=%v\n%s", mode, mapperProducerExpressionQuote, projection.Diagnostics, projection.Text)
			}
		}
		ExpectPending(t, "FuzzMapperProducerExpression", key)
		ExpectPending(t, "FuzzMapperProducerExpression", specCorpusKey(t))
	})
}
