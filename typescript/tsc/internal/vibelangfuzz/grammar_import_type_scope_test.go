package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// TypeScript's checkImportType does not walk checkSourceElements(typeArguments).
// Consequently checkGrammarTypeArguments does not reject an empty or trailing
// list anywhere inside those type arguments. Appendix A delegates native types
// to TypeScript. Copy the type subtree with the two unchecked list alternatives;
// expression initializers and computed property expressions keep their native
// grammar, and a type reference outside an import argument keeps TS1099/TS1009.
func (g *grammarCfg) importTypeArgumentRecovery() {
	selected := map[int]bool{}
	for _, name := range strings.Fields(`
Type TypeNoEffect ConditionalType ConstructorType UnionType IntersectionType
PostfixType PrimaryType TypeArguments TypeList TypeReference TupleType
TupleElementList TupleElement FunctionType ObjectType TypeMemberList TypeMember
TypeAnnotation ReturnType ReturnAnnotation TypePredicate TypeParameters
TypeParameterList TypeParameter PropertySignature MethodSignature CallSignature
GetAccessorSignature SetAccessorSignature IndexSignature MappedType
FormalParameters FormalParameterList FormalParameter
ParameterLikeType ShapedObjectType ShapedMemberList ShapedMember ShapedTarget
ShapedTupleType ShapedElementList ShapedElement ArrowSafeType ArrowSafePostfixType
ArrowSafePrimaryType UnshapedObjectType UnshapedMemberList UnshapedSeparator
UnshapedMember UnshapedTarget ShorthandReservedName UnshapedTupleType
UnshapedElementList UnshapedElement
`) {
		if nt, ok := g.index[name]; ok {
			selected[nt] = true
		}
	}
	rules := slices.Clone(g.rules)
	// Suffix and group helpers may hold a type indirectly. Copy only helpers
	// reachable from the selected type rules, leaving expression rules intact.
	for changed := true; changed; {
		changed = false
		for _, r := range rules {
			if !selected[r.lhs] {
				continue
			}
			for _, s := range r.rhs {
				if s.kind == grammarSymNT && g.helper[s.nt] && !selected[s.nt] {
					selected[s.nt], changed = true, true
				}
			}
		}
	}
	copies := map[int]int{}
	for nt, name := range slices.Clone(g.names) {
		if selected[nt] {
			copy := g.nt("ImportArgument:" + name)
			copies[nt] = copy
			g.helper[copy], g.vibe[copy], g.ordered[copy] = g.helper[nt], g.vibe[nt], g.ordered[nt]
		}
	}
	rewrite := func(rhs []grammarGsym) []grammarGsym {
		rhs = slices.Clone(rhs)
		for i, s := range rhs {
			if copy, ok := copies[s.nt]; ok && s.kind == grammarSymNT {
				rhs[i].nt, rhs[i].text = copy, g.names[copy]
			}
		}
		return rhs
	}
	for _, r := range rules {
		if copy, ok := copies[r.lhs]; ok {
			g.add(copy, rewrite(r.rhs), r.src, r.vibe)
		}
	}
	arguments := copies[g.index["TypeArguments"]]
	list := copies[g.index["TypeList"]]
	g.add(arguments, []grammarGsym{
		{kind: grammarSymTok, text: "<"}, {kind: grammarSymTok, text: ">"},
	}, "ts", false)
	g.add(arguments, []grammarGsym{
		{kind: grammarSymTok, text: "<"},
		{kind: grammarSymNT, nt: list, text: g.names[list]},
		{kind: grammarSymTok, text: ","}, {kind: grammarSymTok, text: ">"},
	}, "ts", false)
	for i := range g.rules {
		if g.names[g.rules[i].lhs] == "ImportType" {
			g.rules[i].rhs = rewrite(g.rules[i].rhs)
		}
	}
}

var grammarImportNestedArgumentForms = []string{
	`type X = import("./m").T<Array<string,>>;`,
	`type X = import("./m").T<Missing<>>;`,
	`type X = import("./m").T<Array<Missing<>,>>;`,
}

func grammarImportNestedArguments() []string {
	var sources []string
	for _, arg := range []string{"Array<string,>", "Missing<>", "Array<Missing<>,>"} {
		for _, wrapper := range []string{
			"%s", "(%s)", "%s[]", "[%s]", "{ value: %s }",
			"(input: %s) => number", "number | %s",
			"number extends string ? never : %s",
		} {
			for _, separator := range []string{"", ","} {
				sources = append(sources, `type X = import("./m").T<`+fmt.Sprintf(wrapper, arg)+separator+`>;`)
				sources = append(sources, `type X = import("./m").T.<`+fmt.Sprintf(wrapper, arg)+separator+`>;`)
			}
		}
	}
	return sources
}

func TestGrammarAdmissionImportNestedArguments(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), "Names not defined here") {
		t.Fatal("Appendix A's native grammar delegation changed")
	}
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	native := grammarBuildGrammar(&grammarAppendixData{file: "ts"})
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarImportNestedArguments() {
		t.Run(source, func(t *testing.T) {
			if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
				t.Errorf("native import argument recovery has no derivation: %s", source)
			}
			if p := native.parse(grammarLexSource(source), mode, nil); p.count() == 0 {
				t.Errorf("native-only grammar lost import argument recovery: %s", source)
			}
		})
	}
	for _, source := range []string{
		"type X = Array<>;", "type X = Array<string,>;",
		"type X = Array<Array<string,>>;",
		`type X = import("./m").T<Array<,>>;`,
		`type X = import("./m").T<Array<string,,>>;`,
		`type X = import("./m").T<,>;`,
		`type X = import("./m").T<string,,>;`,
		`type X = import("./m").T<Array` + "\n" + `<string,>>;`,
	} {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("import argument recovery escaped its native boundary: %s", source)
		}
	}
}

func TestGrammarAdmissionImportNestedArgumentsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarImportNestedArguments() {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("native import argument recovery reads as an admission gap: %s", source)
		}
	}
}
