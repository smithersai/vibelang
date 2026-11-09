package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const declarationDecoratorQuote = "`service`, `error`, `schema` and `data` follow TypeScript's contextual keyword `type`, whose alias declaration is `type` [no LineTerminator here] `BindingIdentifier`."

func TestSchemaDataDecoratorsQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", declarationDecoratorQuote)
}

func FuzzSchemaDataDecorators(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "900-appendices.md", declarationDecoratorQuote)
	rows := []struct{ key, source, twin string }{
		{"schema-struct", "schema Named { n:number }", "const Named={n:0}"},
		{"schema-alias", "schema Named = number", "const Named=0"},
		{"data", "data Named { A }", "type Named={readonly _tag:'A'}"},
		{"data-generic", "data Named<T> { A { n:T } }", "type Named<T>={readonly _tag:'A';readonly n:T}"},
	}
	for _, row := range rows {
		f.Add(row.key, uint8(0), uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, style, home uint8) {
		if key == "" {
			return
		}
		row := rows[int(key[0])%len(rows)]
		for _, r := range rows {
			if key == r.key {
				row = r
				break
			}
		}
		decorators := []string{"@dec", "@(dec)", "@holder.dec", "@dec()", "@dec @dec"}
		dec := decorators[int(style)%len(decorators)]
		gap := []string{" ", "\n", " /* gap */ ", "\r\n"}[int(style/5)%4]
		prefix := dec + gap
		switch home % 3 {
		case 1:
			prefix = "export " + prefix
		case 2:
			prefix += "export "
		}
		codes := func(name, decl string) []string {
			source := prefix + decl + "; const after=1;"
			if home&4 != 0 {
				source = "namespace Box {" + source + "}"
			}
			source = "declare const dec:unknown;declare const holder:{readonly dec:unknown};" + source
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{name: source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var found []string
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				origin := d.Source()
				if origin == "" {
					origin = "TS"
				}
				found = append(found, fmt.Sprintf("%s%04d", origin, d.Code()))
			}
			return found
		}
		// The native type/constant declaration rejects decorators with TS1206.
		// A generated companion is not a second decorated source declaration.
		native := codes("main.ts", row.twin)
		actual := codes("main.vibe", row.source)
		if strings.Join(native, ",") != "TS1206" || strings.Join(actual, ",") != "TS1206" {
			Gap(t, "FuzzSchemaDataDecorators", row.key, "native declaration requires one TS1206; native=%v Vibe=%v", native, actual)
		}
	})
}
