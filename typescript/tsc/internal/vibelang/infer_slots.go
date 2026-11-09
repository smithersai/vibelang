package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Effect slots written `infer` (VIP-3, amended 2026-11-02).
//
// An effect function's return annotation means what the same annotation
// means on the equivalent Effect.fn or Effect.gen TypeScript. TypeScript has
// no `infer` outside a conditional type's extends clause (TS1338), so
// Effect<A, infer E, R> has no Effect TypeScript twin and is retired through
// the legacy path: EK4857 reports it, and its fix, which vibelang --fix
// applies, writes the type the checker infers for each such slot, or removes
// an effect function's annotation when every slot is `infer`, which declares
// the same type. The checker still fills the slots in (annotatedReturnType),
// so the fix and the program's types agree until the form is removed.

var EK4857 = message(4857, errorCategory, "An Effect slot written infer has no Effect TypeScript spelling; write the type the body gives it, or leave out the whole return annotation.")

func init() {
	registry[EK4857.Code] = EK4857
	fileChecks = append(fileChecks, func(c *checker.Checker, file *ast.SourceFile) {
		checkFormRules(c, file, []*Message{EK4857})
	})
	tsFormRules[EK4857.Code] = &tsFormRule{
		message: EK4857,
		find: func(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if isLowerable(node) && node.Type() != nil && inferSlotAnnotation(c, node.Type()) {
					report(node.Type(), inferSlotRewrite(c, file, node.Type()))
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
		},
	}
}

// inferSlotAnnotation reports whether annotation, a function's return
// annotation, is a contract that writes a slot `infer Name`.
func inferSlotAnnotation(c *checker.Checker, annotation *ast.Node) bool {
	fn := annotation.Parent
	if fn == nil || fn.Type() != annotation || !isLowerable(fn) {
		return false
	}
	k := analyzerFor(c).contractOf(fn)
	return k != nil && k.reference == annotation && k.inferredAny()
}

// inferSlotRewrite plans EK4857's fix: each `infer` slot becomes the type
// the checker inferred for it, so the declared type stays the same. When
// every slot is `infer` on a function marked effect, the annotation goes,
// as the unannotated function infers all three slots. A slot whose type
// cannot be written at the annotation, such as a callback's type parameter,
// leaves nothing to apply.
func inferSlotRewrite(c *checker.Checker, file *ast.SourceFile, annotation *ast.Node) *formRewrite {
	if !inferSlotAnnotation(c, annotation) {
		return nil
	}
	fn := annotation.Parent
	k := analyzerFor(c).contractOf(fn)
	if len(k.channels) == 3 && k.inferred(channelA) && k.inferred(channelE) && k.inferred(channelR) && isMarkedEffect(fn) {
		if at := returnTypePosition(file, fn); at >= 0 && at <= nodeStart(file, annotation) {
			return &formRewrite{description: "an unannotated function, which infers all three slots", edits: []sourceEdit{{at, annotation.End(), ""}}}
		}
		return nil
	}
	declared := c.GetReturnTypeOfSignature(c.GetSignatureFromDeclaration(fn))
	if !isMarkedEffect(fn) {
		// A plain callable returns its body's Effect unrun. Filling an infer
		// slot cannot repair a written channel that conflicts with that Effect;
		// withhold the quick fix under VIP-34's preservation rule.
		returned := plainReturnedEffect(c, fn)
		if returned == nil {
			return nil
		}
		for i, slot := range k.channels {
			if slot.Kind != ast.KindInferType && !c.IsTypeAssignableTo(channelType(c, returned, []string{"_A", "_E", "_R"}[i]), c.GetTypeFromTypeNode(slot)) {
				return nil
			}
		}
	}
	filled := []*checker.Type{successType(c, declared), channelType(c, declared, "_E"), channelType(c, declared, "_R")}
	bang := annotation.AsTypeReferenceNode().TypeName.Flags&ast.NodeFlagsReparsed != 0
	var edits []sourceEdit
	for i, slot := range k.channels {
		if slot.Kind != ast.KindInferType {
			continue
		}
		t := filled[i]
		if t == nil || t.Flags()&(checker.TypeFlagsAny) != 0 || !writable(t, annotation) {
			return nil
		}
		text := typeTextAt(c, t, annotation)
		if bang {
			text = bangSlot(text, i > channelA)
			if i == channelA && (hasTopLevel(text, "|") || hasTopLevel(text, "&")) {
				text = "(" + text + ")"
			}
		}
		edits = append(edits, sourceEdit{nodeStart(file, slot), slot.End(), text})
	}
	if len(edits) == 0 {
		return nil
	}
	r := &formRewrite{edits: edits}
	r.description = rewrittenText(file, annotation, edits)
	return r
}

// plainReturnedEffect is the Effect an unmarked callable's body returns: the
// union of its returned expressions' types, or nil when a return is bare or
// is not an Effect.
func plainReturnedEffect(c *checker.Checker, fn *ast.Node) *checker.Type {
	body := fn.Body()
	if body == nil {
		return nil
	}
	var types []*checker.Type
	ok := true
	if body.Kind == ast.KindBlock {
		forEachReturn(body, func(e *ast.Node) {
			if e == nil {
				ok = false
				return
			}
			types = append(types, returnedType(c, e, true))
		})
	} else {
		types = append(types, returnedType(c, body, true))
	}
	if !ok || len(types) == 0 {
		return nil
	}
	t := c.GetUnionType(types)
	if !isEffectType(c, t) {
		return nil
	}
	return t
}

// writable reports whether t, and each member of a union t, can be written
// at node: no type parameter that node's declarations do not declare.
func writable(t *checker.Type, node *ast.Node) bool {
	for _, member := range unionMembers(t) {
		if !inScope(member, node) {
			return false
		}
	}
	return true
}

// rewrittenText is node's text with edits, which lie within it, applied.
func rewrittenText(file *ast.SourceFile, node *ast.Node, edits []sourceEdit) string {
	text := file.Text()
	start := nodeStart(file, node)
	out := ""
	at := start
	for _, edit := range edits {
		out += text[at:edit.start] + edit.text
		at = edit.end
	}
	return out + text[at:node.End()]
}
