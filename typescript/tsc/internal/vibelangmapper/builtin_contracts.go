package vibelangmapper

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

//go:generate go run gen_builtin_contracts.go

// builtinFailure recognizes an unshadowed shipped contract. Effect bodies
// use it whether caught or escaping; plain bodies use only caught contracts.
func (p *projector) builtinFailure(call *ast.Node) string {
	target := call.Expression()
	root, chain, ok := formsNameChain(target)
	if !ok || call.QuestionDotToken() != nil {
		return ""
	}
	if r, ok := p.forms.(*Resolver); ok && r.binding(root, root.Text()) != nil {
		return ""
	}
	key := root.Text()
	for _, part := range chain {
		key += "." + part
	}
	return builtinContracts[key]
}

// renderBuiltinCall shares the shipped failure boundary between both renderings.
func renderBuiltinCall(e edit) string {
	return builtinCallText(e, true)
}

// builtinCallText captures each argument before the trusted thunk runs. Using
// an indexed parameter type retains the original call's arity, including a
// one-argument JSON.parse despite its two-argument ES2026 overload.
func builtinCallText(e edit, checking bool) string {
	failure, callee, base := e.fields[0], e.fields[1], e.fields[2]
	count, _ := strconv.Atoi(e.fields[3])
	var params, args []string
	for i := 0; i < count; i++ {
		name := base + strconv.Itoa(i)
		args = append(args, name)
		if checking {
			name += ": " + helperRef("$BuiltinArgs") + "<typeof " + callee + ">[" + strconv.Itoa(i) + "]"
		}
		params = append(params, name)
	}
	fn := base + "Fn"
	helper := "$trusted"
	if len(e.fields) > 4 && e.fields[4] == "true" {
		helper = "$trustedPlain"
	}
	trusted := helperRef(helper)
	if checking {
		trusted += "<" + helperRef("$BuiltinResult") + "<typeof " + callee + ">, " + failure + ">"
	}
	fnParam := fn
	if checking {
		fnParam += ": typeof " + callee
	}
	return "((" + fnParam + ") => ((" + strings.Join(params, ", ") + ") => " + trusted + "(() => " + fn + "(" + strings.Join(args, ", ") + "), [" + failure + "])))(" + callee + ")"
}
