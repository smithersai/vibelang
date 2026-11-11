package vibelangmapper

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"gotest.tools/v3/assert"
)

// assertWrittenNameMaps checks that the one occurrence of word on the
// projection's line that holds marker maps exactly to source offset at, in a
// segment every language feature may use.
func assertWrittenNameMaps(t *testing.T, projection Projection, source string, marker string, word string, at int) {
	t.Helper()
	body := strings.Index(projection.Text, "\n") + 1
	from := body + strings.Index(projection.Text[body:], marker)
	assert.Assert(t, from >= body, "%q is not in the projection: %s", marker, projection.Text)
	line := projection.Text[from:]
	if end := strings.IndexByte(line, '\n'); end >= 0 {
		line = line[:end]
	}
	assert.Equal(t, strings.Count(line, word), 1, "%q on the line of %q in: %s", word, marker, projection.Text)
	virtual := from + strings.Index(line, word)
	m := spanmap.New(projection.Segments)
	original, fidelity := m.VirtualToOriginalSpanForFeature(core.NewTextRange(virtual, virtual+len(word)), spanmap.FeatureRename)
	assert.Assert(t, fidelity.IsExact(), "%q at virtual %d maps with fidelity %v, to %v; source %q", word, virtual, fidelity, original, source)
	assert.Equal(t, original.Pos(), at, "%q; source %q", word, source)
	assert.Equal(t, source[original.Pos():original.End()], word)
	back := m.OriginalToVirtualSpans(core.NewTextRange(at, at+len(word)), spanmap.FeatureDefinition)
	assert.Assert(t, len(back) == 1 && back[0].Fidelity.IsExact() && back[0].Span.Pos() == virtual, "%q at source %d maps to virtual %v, want %d", word, at, back, virtual)
}

// TestSchemaDeclarationNamesMap checks that a TypeScript answer inside a
// schema declaration lands on what the user wrote: the declaration's name,
// each field name and each written type have their own span map segment, in
// the checking and the executable rendering.
func TestSchemaDeclarationNamesMap(t *testing.T) {
	t.Parallel()
	source := "schema Address { city: string }\nschema User {\n  id: string\n  home: Adress\n  age: Schema.NumberFromStrin\n}\nexport const u: User = { id: \"1\", home: { city: \"x\" }, age: 1 }\n"
	assert.Equal(t, strings.Index(source, "Adress"), 67)
	for name, project := range map[string]func(string, FileContext) Projection{"checking": Project, "executable": Executable} {
		t.Run(name, func(t *testing.T) {
			projection := project(source, testContext)
			assertValidMap(t, projection, source)
			assertWrittenNameMaps(t, projection, source, "const Address", "Address", 7)
			assertWrittenNameMaps(t, projection, source, "const Address", "city", 17)
			assertWrittenNameMaps(t, projection, source, "const User", "User", 39)
			assertWrittenNameMaps(t, projection, source, "const User", "id", 48)
			assertWrittenNameMaps(t, projection, source, "const User", "home", 61)
			assertWrittenNameMaps(t, projection, source, "const User", "Adress", 67)
			assertWrittenNameMaps(t, projection, source, "const User", "age", 76)
			assertWrittenNameMaps(t, projection, source, "const User", "Schema.NumberFromStrin", 81)
		})
	}
}

// TestSchemaDeclarationText checks the projected text of schema declarations
// whose names stay in place: comments between the kept names are dropped, and
// declarations in a function or a namespace keep their surroundings.
func TestSchemaDeclarationText(t *testing.T) {
	t.Parallel()
	for _, c := range []struct{ source, want string }{
		{
			"schema Address { city: string }\nschema User {\n  id: string\n  home: Adress\n  age: Schema.NumberFromStrin\n}\n",
			"interface Address extends Schema.Schema.Type<typeof Address> {}\nconst Address = Schema.Struct({ city: Schema.mutableKey(Schema.String) });\ninterface User extends Schema.Schema.Type<typeof User> {}\nconst User = Schema.Struct({ id: Schema.mutableKey(Schema.String), home: Schema.mutableKey(Adress), age: Schema.mutableKey(Schema.NumberFromStrin) });\n",
		},
		{
			"schema Ids = Adres[];\n",
			"type Ids = typeof Ids.Type;\nconst Ids = Schema.mutable(Schema.Array(Adres));\n",
		},
		{
			"export schema Box { readonly \"quoted-key\": Inner; opt?: Other; list: Elem[]; pair: ReadonlyMap<KeyT, ValT>; nested: { deep: DeepT }; either: LeftT | RightT; lit: \"a\" | \"b\"; tup: [TupA, TupB]; rec: Record<string, RecT>; n: number | null; [computed]: CompT; 12: NumT }\n",
			"export interface Box extends Schema.Schema.Type<typeof Box> {}\nexport const Box = Schema.Struct({ \"quoted-key\": Inner, opt: Schema.mutableKey(Schema.optional(Other)), list: Schema.mutableKey(Schema.mutable(Schema.Array(Elem))), pair: Schema.mutableKey(Schema.ReadonlyMap(KeyT, ValT)), nested: Schema.mutableKey(Schema.Struct({ deep: Schema.mutableKey(DeepT) })), either: Schema.mutableKey(Schema.Union([LeftT, RightT])), lit: Schema.mutableKey(Schema.Literals([\"a\", \"b\"])), tup: Schema.mutableKey(Schema.mutable(Schema.Tuple([TupA, TupB]))), rec: Schema.mutableKey(Schema.Record(Schema.String, Schema.mutableKey(RecT))), n: Schema.mutableKey(Schema.Union([Schema.Number, Schema.Null])), [computed]: Schema.mutableKey(CompT), 12: Schema.mutableKey(NumT) });\n",
		},
		{
			"schema /*c1*/ Gen /*c2*/ { /*c3*/ a /*c4*/ : /*c5*/ Aaa /*c6*/ ; // tail\n b: Array<Bbb> }\n",
			"interface Gen extends Schema.Schema.Type<typeof Gen> {}\nconst Gen = Schema.Struct({ a: Schema.mutableKey(Aaa), b: Schema.mutableKey(Schema.mutable(Schema.Array(Bbb))) });\n",
		},
		{
			"function f() { schema Local { x: Xx } }\nnamespace N { export schema Inner = Yy }\n",
			"function f() { return $gen(function* () { interface Local extends Schema.Schema.Type<typeof Local> {}\nconst Local = Schema.Struct({ x: Schema.mutableKey(Xx) }); })}\nnamespace N { export type Inner = typeof Inner.Type;\nexport const Inner = Yy; }\n",
		},
	} {
		projection := Project(c.source, testContext)
		assert.Equal(t, virtualBody(t, projection), c.want)
		assertValidMap(t, projection, c.source)
		assertParses(t, projection.Text)
	}
}

// schemaSpanForms are the field shapes FuzzSchemaDeclarationSpans writes.
// A field is prefix, its name, suffix, a colon and the type; an alias is the
// type alone. $A, $B and $G stand for names the generator makes unique.
var schemaSpanForms = []struct{ key, prefix, suffix, typ string }{
	{"named", "", "", "$A"},
	{"optional", "", "?", "$A"},
	{"readonly", "readonly ", "", "$A"},
	{"array", "", "", "$A[]"},
	{"generic-array", "", "", "Array<$A>"},
	{"union", "", "", "$A | $B"},
	{"nullable", "", "", "$A | null"},
	{"tuple", "", "", "[$A, $B]"},
	{"nested", "", "", "{ $G: $A; readonly $H?: $B[] }"},
	{"record", "", "", "Record<string, $A>"},
	{"map", "", "", "ReadonlyMap<$A, $B>"},
	{"set", "", "", "ReadonlySet<$A>"},
	{"qualified", "", "", "Schema.$A"},
	{"commented", " /* before */ ", " /* after */ ", "/* type */ $A /* end */"},
	{"keyword", "", "", "string"},
	{"literal", "", "", "\"a\" | \"b\""},
}

type schemaSpanName struct {
	marker string // the text the declaration's projected line holds
	word   string
	at     int
}

// schemaSpanSource writes schema declarations from input: each word is a
// form's key, or picks a form by its bytes; alias:<form> writes a schema
// alias; export, function and namespace change where the struct is declared.
func schemaSpanSource(input string) (source string, names []schemaSpanName) {
	var out strings.Builder
	next := 0
	name := func(marker string, prefix string) string {
		next++
		word := fmt.Sprintf("%s%dx", prefix, next)
		names = append(names, schemaSpanName{marker: marker, word: word, at: out.Len()})
		return word
	}
	writeType := func(marker string, typ string) {
		for typ != "" {
			at := strings.IndexByte(typ, '$')
			if at < 0 {
				out.WriteString(typ)
				return
			}
			out.WriteString(typ[:at])
			out.WriteString(name(marker, map[byte]string{'A': "Typ", 'B': "Alt", 'G': "Sub", 'H': "Opt"}[typ[at+1]]))
			typ = typ[at+2:]
		}
	}
	exported, open, shut := "", "", ""
	var fields, aliases []int
	for _, word := range strings.Fields(input) {
		switch word {
		case "export":
			exported = "export "
			continue
		case "function":
			open, shut = "function scope() { ", " }\n"
			continue
		case "namespace":
			open, shut = "namespace Scope { ", " }\n"
			continue
		}
		key, alias := strings.CutPrefix(word, "alias:")
		form := -1
		for i := range schemaSpanForms {
			if schemaSpanForms[i].key == key {
				form = i
			}
		}
		if form < 0 {
			sum := 0
			for _, b := range []byte(key) {
				sum += int(b)
			}
			form = sum % len(schemaSpanForms)
		}
		if alias {
			aliases = append(aliases, form)
		} else {
			fields = append(fields, form)
		}
		if len(fields)+len(aliases) == 12 {
			break
		}
	}
	out.WriteString(open)
	if open == "" {
		out.WriteString(exported)
	}
	out.WriteString("schema ")
	marker := "const Struct0x = "
	names = append(names, schemaSpanName{marker: marker, word: "Struct0x", at: out.Len()})
	out.WriteString("Struct0x {\n")
	for _, form := range fields {
		f := schemaSpanForms[form]
		out.WriteString("  " + f.prefix)
		out.WriteString(name(marker, "Fld"))
		out.WriteString(f.suffix + ": ")
		writeType(marker, f.typ)
		out.WriteString("\n")
	}
	out.WriteString("}")
	out.WriteString(shut)
	out.WriteString("\n")
	for _, form := range aliases {
		out.WriteString(exported + "schema ")
		next++
		alias := fmt.Sprintf("Ali%dx", next)
		marker := "const " + alias + " = "
		names = append(names, schemaSpanName{marker: marker, word: alias, at: out.Len()})
		out.WriteString(alias + " = ")
		writeType(marker, schemaSpanForms[form].typ)
		out.WriteString("\n")
	}
	return out.String(), names
}

// FuzzSchemaDeclarationSpans holds every name written in a schema
// declaration to its own exact span map segment: the declaration's name,
// field names, and each type name, whatever wrappers the projection inserts
// around them.
func FuzzSchemaDeclarationSpans(f *testing.F) {
	all := ""
	for _, form := range schemaSpanForms {
		f.Add(form.key)
		f.Add("alias:" + form.key)
		all += form.key + " "
	}
	for _, seed := range []string{"", all, "export " + all, "function " + all, "namespace export nested map alias:tuple alias:nested", "export alias:map alias:set alias:qualified commented"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		if len(input) > 1024 {
			t.Skip()
		}
		source, names := schemaSpanSource(input)
		for _, project := range []func(string, FileContext) Projection{Project, Executable} {
			projection := project(source, testContext)
			assertValidMap(t, projection, source)
			for _, name := range names {
				assertWrittenNameMaps(t, projection, source, name.marker, name.word, name.at)
			}
		}
	})
}

// Normalized identifiers and own proto keys change spelling in the projection.
// Their whole token must still point to the written name.
func TestSchemaDeclarationTransformedNamesMap(t *testing.T) {
	for _, declaration := range []string{"Box", `\u0042ox`} {
		for _, key := range []string{"__proto__", `"__proto__"`, `"__pro\u0074o__"`, `__pro\u0074o__`} {
			source := "schema " + declaration + " { readonly " + key + ": Value }\nexport const after = 1\n"
			virtualKey := `["__proto__"]`
			if key == "__proto__" || key == `"__proto__"` {
				virtualKey = key
			}
			for rendering, project := range map[string]func(string, FileContext) Projection{"checking": Project, "executable": Executable} {
				t.Run(rendering+"/"+declaration+"/"+key, func(t *testing.T) {
					projection := project(source, testContext)
					assertValidMap(t, projection, source)
					mapping := spanmap.New(projection.Segments)
					for _, name := range []struct{ virtual, original string }{{"Box", declaration}, {virtualKey, key}} {
						from := strings.Index(projection.Text, "const Box")
						virtual := from + strings.Index(projection.Text[from:], name.virtual)
						at := strings.Index(source, name.original)
						got, fidelity := mapping.VirtualToOriginalSpanForFeature(core.NewTextRange(virtual, virtual+len(name.virtual)), spanmap.FeatureDefinition)
						assert.Assert(t, fidelity.IsSingleSegment(), "%s maps with fidelity %v", name.original, fidelity)
						if name.virtual == name.original {
							assert.Assert(t, fidelity.IsExact())
						}
						assert.Equal(t, got, core.NewTextRange(at, at+len(name.original)))
						back := mapping.OriginalToVirtualSpans(got, spanmap.FeatureHover)
						assert.Equal(t, len(back), 1)
						assert.Assert(t, back[0].Fidelity.IsSingleSegment())
						assert.Equal(t, back[0].Span, core.NewTextRange(virtual, virtual+len(name.virtual)))
					}
					assertWrittenNameMaps(t, projection, source, "const Box", "Value", strings.Index(source, "Value"))
					assertWrittenNameMaps(t, projection, source, "export const after", "after", strings.Index(source, "after"))
				})
			}
		}
	}
}

func TestSchemaAtomFollowedByVerbatim(t *testing.T) {
	source := `\u0061 tail`
	var edits plan
	edits.replaceAtom(0, 6, "a")
	for _, renderer := range []rendering{checking{}, executable{}} {
		text, segments, _, ok := edits.render(renderer, source, func() string { return "" })
		assert.Assert(t, ok)
		assert.Equal(t, text, "a tail")
		mapping := spanmap.New(segments)
		assert.Assert(t, mapping.Validate(text, source) == nil)
		atom, fidelity := mapping.VirtualToOriginalSpanForFeature(core.NewTextRange(0, 1), spanmap.FeatureDefinition)
		assert.Equal(t, fidelity, spanmap.FidelityAtom)
		assert.Equal(t, atom, core.NewTextRange(0, 6))
		tail, fidelity := mapping.VirtualToOriginalSpanForFeature(core.NewTextRange(1, 6), spanmap.FeatureRename)
		assert.Assert(t, fidelity.IsExact())
		assert.Equal(t, tail, core.NewTextRange(6, 11))
	}
}
