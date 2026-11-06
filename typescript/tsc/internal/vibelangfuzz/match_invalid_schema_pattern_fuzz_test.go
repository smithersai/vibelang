package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const invalidSchemaPatternTarget = "FuzzInvalidSchemaPatternRecovery"
const invalidSchemaPatternQuote = "A class pattern whose expression resolves to a \x60data\x60 declaration or variant constructor, a \x60schema\x60 declaration or a directly constructed \x60Context.Reference\x60 is \x60EK0702\x60"
const invalidSchemaDispatchQuote = "After own matchers, fixed patterns, built-ins and declaration diagnostics, dispatch uses the callee’s static signatures"

func invalidSchemaPatternQuotes(tb testing.TB) {
	tb.Helper()
	for _, quote := range []string{invalidSchemaPatternQuote, invalidSchemaDispatchQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			tb.Fatalf("schema pattern admission rule changed: %q", quote)
		}
	}
}
func TestInvalidSchemaPatternRecoveryQuoted(t *testing.T) { invalidSchemaPatternQuotes(t) }

var invalidSchemaShapes = []string{"struct", "alias", "namespace", "import"}
var invalidSchemaFields = []struct{ name, typ string }{{"street", "string"}, {"amount", "number"}, {"enabled", "boolean"}}

func FuzzInvalidSchemaPatternRecovery(f *testing.F) {
	startShortBudget(f)
	invalidSchemaPatternQuotes(f)
	for _, key := range invalidSchemaShapes {
		f.Add(key, uint8(0), uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, fieldIndex, variant uint8) {
		shape := slices.Index(invalidSchemaShapes, key)
		if shape < 0 {
			if key == "" {
				return
			}
			shape = int(key[0]) % len(invalidSchemaShapes)
		}
		field := invalidSchemaFields[int(fieldIndex)%len(invalidSchemaFields)]
		variant %= 3
		header := "import {Schema} from \"effect\";"
		declaration := fmt.Sprintf("schema Address{%s:%s};", field.name, field.typ)
		matcher := "Address"
		files := map[string]string{"package.json": servicesPackage}
		switch shape {
		case 0:
			header += declaration
		case 1:
			header += fmt.Sprintf("schema Address={%s:%s};", field.name, field.typ)
		case 2:
			header += "namespace N{export " + declaration + "};"
			matcher = "N.Address"
		case 3:
			files["shapes.vibe"] = "export " + declaration
			header += "import {Address as Place} from \"./shapes.vibe\";"
			matcher = "Place"
		}
		body := field.name
		if variant == 1 {
			body = "({source:1}).missing"
		}
		source := header + "export function read(s:unknown){return match(s){when " + matcher + " {let " + field.name + "}: " + body + ";default:undefined;}}"
		if variant == 2 {
			source = header + "export function read(s:unknown){return match(s){when let value and if(Schema.is(" + matcher + ")(value)): value." + field.name + ";default:undefined;}}"
		}
		files["main.vibe"] = source
		config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"allowImportingTsExtensions\":true,\"noEmit\":true},\"files\":[\"main.vibe\"]}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var errors []string
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			origin := d.Source()
			if origin == "" {
				origin = "TS"
			}
			errors = append(errors, fmt.Sprintf("%s%d", origin, d.Code()))
			if d.Code() == 2339 && variant == 1 {
				if d.Pos() < 0 || d.End() > len(source) || source[d.Pos():d.End()] != "missing" {
					Gap(t, invalidSchemaPatternTarget, "source-span:"+fmt.Sprintf("%s:%s", invalidSchemaShapes[shape], field.name), "the independent source error must point at missing, got [%d,%d): %s", d.Pos(), d.End(), d.String())
					return
				}
			}
		}
		expected := [][]string{{"EK702"}, {"EK702", "TS2339"}, nil}[variant]
		slices.Sort(errors)
		slices.Sort(expected)
		precise := fmt.Sprintf("%s:%s:%d", invalidSchemaShapes[shape], field.name, variant)
		if !slices.Equal(errors, expected) {
			Gap(t, invalidSchemaPatternTarget, precise, "%s; expected %v, got %v\n%s", invalidSchemaPatternQuote, expected, errors, source)
			return
		}
		ExpectPending(t, invalidSchemaPatternTarget, precise)
		if variant == 1 {
			ExpectPending(t, invalidSchemaPatternTarget, "source-span:"+fmt.Sprintf("%s:%s", invalidSchemaShapes[shape], field.name))
		}
		ExpectPending(t, invalidSchemaPatternTarget, specCorpusKey(t))
	})
}
