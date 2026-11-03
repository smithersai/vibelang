package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const schemaTypeParameterQuote = "type parameters on a `schema` declaration; use an ordinary generic TypeScript factory returning a Schema value"
const schemaHeaderLineBreakQuote = "No other line-break or disambiguation rule applies to these four words."

func TestSchemaTypeParameterAdmissionQuoted(t *testing.T) {
	schemaTypeParameterQuoted(t)
}

func schemaTypeParameterQuoted(t testing.TB) {
	t.Helper()
	for chapter, quote := range map[string]string{"006-data.md": schemaTypeParameterQuote, "900-appendices.md": schemaHeaderLineBreakQuote} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

type schemaTypeParameterRule struct{ key, source string }

func schemaTypeParameterRules() []schemaTypeParameterRule {
	var rules []schemaTypeParameterRule
	for _, body := range []struct{ key, text string }{{"body", "{name:string}"}, {"alias", "= string"}} {
		for _, params := range []struct{ key, text string }{
			{"single", "T"}, {"multiple", "T, U"}, {"constraint", "T extends {value:[string, number]}"},
			{"default", "T = string"}, {"const", "const T"}, {"in", "in T"}, {"out", "out T"}, {"variance", "in T, out U"},
		} {
			for _, name := range []string{"User", "as", "error"} {
				for _, prefix := range []struct{ key, text string }{{"local", ""}, {"export", "export "}} {
					key := body.key + "-" + params.key + "-" + name + "-" + prefix.key
					source := prefix.text + "schema " + name + "@gap@<" + params.text + ">@gap@" + body.text + "; export const kept = 1"
					rules = append(rules, schemaTypeParameterRule{key, source})
				}
			}
		}
	}
	return rules
}

// Chapter 006 owns forbidden headers, independently of the body mapping.
// Keyed rules mutate parameters, declaration names, alias/body forms, exports,
// file kinds and native line-break/comment trivia. No runtime oracle is added.
func FuzzSchemaTypeParameterAdmission(f *testing.F) {
	startShortBudget(f)
	schemaTypeParameterQuoted(f)
	rules := schemaTypeParameterRules()
	for _, r := range rules {
		for mutation := uint8(0); mutation < 5; mutation++ {
			f.Add([]byte("key:"+r.key), mutation)
		}
	}
	f.Fuzz(func(t *testing.T, data []byte, mutation uint8) {
		if len(data) == 0 {
			return
		}
		index := int(data[0]) % len(rules)
		for i, r := range rules {
			if string(data) == "key:"+r.key {
				index = i
				break
			}
		}
		r := rules[index]
		gaps := []string{" ", " /* gap */ ", "\n", "\r\n", " // gap\n"}
		source := strings.ReplaceAll(r.source, "@gap@", gaps[int(mutation)%len(gaps)])
		for _, name := range []string{"/main.vibe", "/main.vibex"} {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(name), PathKey: tspath.PathKey(name)}, source)
			ds := file.Diagnostics()
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 1502 {
				Gap(t, "FuzzSchemaTypeParameterAdmission", r.key+"-"+name[6:], "chapter 006 requires only EK1502; got %v", ds)
			}
		}
	})
}
