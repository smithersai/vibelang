package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

type schemaTuplePosition struct {
	typ      *ast.Node
	optional bool
	rest     bool
}

// Literal variadic tuples are normalized like native TypeScript tuples before
// mapping their fixed, optional, repeating and trailing positions to schemas.
func (p *Parser) vibelangSchemaTuple(typeNode *ast.Node) *ast.Node {
	positions, valid, supported := p.vibelangSchemaTuplePositions(typeNode)
	if !valid {
		return p.vibelangSchemaMember(nil, "Unknown", typeNode.Loc)
	}
	if !supported {
		return p.vibelangUnsupportedSchema(typeNode.Loc)
	}
	var fixed, rest []*ast.Node
	inRest := false
	for _, position := range positions {
		inRest = inRest || position.rest
		value := p.vibelangSchemaOf(position.typ)
		if position.optional {
			value = p.vibelangSchemaCall("optional", position.typ.Loc, value)
		}
		if inRest {
			rest = append(rest, value)
		} else {
			fixed = append(fixed, value)
		}
	}
	elements := p.vibelangSpanning(p.factory.NewArrayLiteralExpression(p.newNodeList(typeNode.Loc, fixed), false), typeNode.Loc)
	tuple := p.vibelangSchemaCall("Tuple", typeNode.Loc, elements)
	if inRest {
		elements = p.vibelangSpanning(p.factory.NewArrayLiteralExpression(p.newNodeList(typeNode.Loc, rest), false), typeNode.Loc)
		tuple = p.vibelangSchemaCall("TupleWithRest", typeNode.Loc, tuple, elements)
	}
	return tuple
}

func schemaTupleElement(node *ast.Node) schemaTuplePosition {
	switch node.Kind {
	case ast.KindNamedTupleMember:
		member := node.AsNamedTupleMember()
		return schemaTuplePosition{member.Type, member.QuestionToken != nil, member.DotDotDotToken != nil}
	case ast.KindOptionalType:
		return schemaTuplePosition{node.AsOptionalTypeNode().Type, true, false}
	case ast.KindRestType:
		return schemaTuplePosition{node.AsRestTypeNode().Type, false, true}
	}
	return schemaTuplePosition{typ: node}
}

func schemaLiteralRestTuple(node *ast.Node) *ast.Node {
	for node != nil && node.Kind == ast.KindParenthesizedType {
		node = node.AsParenthesizedTypeNode().Type
	}
	if node != nil && node.Kind == ast.KindTypeOperator && node.AsTypeOperatorNode().Operator == ast.KindReadonlyKeyword {
		node = node.AsTypeOperatorNode().Type
	}
	if node != nil && node.Kind == ast.KindTupleType {
		return node
	}
	return nil
}

func schemaTupleHasArrayRest(tuple *ast.Node) bool {
	for _, node := range tuple.AsTupleTypeNode().Elements.Nodes {
		element := schemaTupleElement(node)
		if !element.rest {
			continue
		}
		if vibelangSchemaRestElement(element.typ) != nil {
			return true
		}
		if nested := schemaLiteralRestTuple(element.typ); nested != nil && schemaTupleHasArrayRest(nested) {
			return true
		}
	}
	return false
}

// Check the written grammar before expanding variadic literals. Their required
// positions do not make an optional source prefix illegal; normalization adds
// undefined and makes those earlier positions required.
func (p *Parser) vibelangSchemaTupleGrammar(tuple *ast.Node) bool {
	valid := true
	seenOptional, seenRest := false, false
	elements := tuple.AsTupleTypeNode().Elements.Nodes
	for _, node := range elements {
		element := schemaTupleElement(node)
		arrayRest := false
		if element.rest {
			if vibelangSchemaRestElement(element.typ) != nil {
				arrayRest = true
			} else if nested := schemaLiteralRestTuple(element.typ); nested != nil {
				arrayRest = schemaTupleHasArrayRest(nested)
			} else {
				break
			}
		}
		var message *diagnostics.Message
		switch {
		case arrayRest:
			if seenRest {
				message = diagnostics.A_rest_element_cannot_follow_another_rest_element
			}
			seenRest = true
		case element.optional:
			if seenRest {
				message = diagnostics.An_optional_element_cannot_follow_a_rest_element
			}
			seenOptional = true
		case !element.rest && seenOptional:
			message = diagnostics.A_required_element_cannot_follow_an_optional_element
		}
		if message != nil {
			p.parseErrorAtRange(p.skipRangeTrivia(node.Loc), message)
			valid = false
			break
		}
	}
	for _, node := range elements {
		if node.Kind != ast.KindNamedTupleMember {
			continue
		}
		member := node.AsNamedTupleMember()
		if member.DotDotDotToken != nil && member.QuestionToken != nil {
			p.parseErrorAtRange(p.skipRangeTrivia(node.Loc), diagnostics.A_tuple_member_cannot_be_both_optional_and_rest)
			valid = false
		}
		if member.Type.Kind == ast.KindOptionalType {
			p.parseErrorAtRange(p.skipRangeTrivia(member.Type.Loc), diagnostics.A_labeled_tuple_element_is_declared_as_optional_with_a_question_mark_after_the_name_and_before_the_colon_rather_than_after_the_type)
			valid = false
		}
		if member.Type.Kind == ast.KindRestType {
			p.parseErrorAtRange(p.skipRangeTrivia(member.Type.Loc), diagnostics.A_labeled_tuple_element_is_declared_as_rest_with_a_before_the_name_rather_than_before_the_type)
			valid = false
		}
	}
	return valid
}

func (p *Parser) schemaTupleUnion(types []*ast.Node) *ast.Node {
	var flattened []*ast.Node
	var add func(*ast.Node)
	add = func(typ *ast.Node) {
		for typ.Kind == ast.KindParenthesizedType {
			typ = typ.AsParenthesizedTypeNode().Type
		}
		if typ.Kind == ast.KindUnionType {
			for _, part := range typ.AsUnionTypeNode().Types.Nodes {
				add(part)
			}
		} else {
			flattened = append(flattened, typ)
		}
	}
	for _, typ := range types {
		add(typ)
	}
	if len(flattened) == 1 {
		return flattened[0]
	}
	at := types[0].Loc
	return p.vibelangSpanning(p.factory.NewUnionTypeNode(p.newNodeList(at, flattened)), at)
}

func (p *Parser) schemaTupleUndefined(typ *ast.Node) *ast.Node {
	undefined := p.vibelangSynthesized(p.factory.NewKeywordTypeNode(ast.KindUndefinedKeyword), typ.Loc)
	return p.schemaTupleUnion([]*ast.Node{typ, undefined})
}

// This follows native TupleNormalizer: expand literal variadics, require every
// optional before the last required position, and merge the first rest through
// the last optional/rest into a union-valued rest. An opaque rest stays a gap.
func (p *Parser) vibelangSchemaTuplePositions(tuple *ast.Node) ([]schemaTuplePosition, bool, bool) {
	if !p.vibelangSchemaTupleGrammar(tuple) {
		return nil, false, true
	}
	var positions []schemaTuplePosition
	for _, node := range tuple.AsTupleTypeNode().Elements.Nodes {
		element := schemaTupleElement(node)
		if element.rest {
			if nested := schemaLiteralRestTuple(element.typ); nested != nil {
				expanded, valid, supported := p.vibelangSchemaTuplePositions(nested)
				if !valid || !supported {
					return nil, valid, supported
				}
				positions = append(positions, expanded...)
				continue
			}
			element.typ = vibelangSchemaRestElement(element.typ)
			if element.typ == nil {
				return nil, true, false
			}
		}
		positions = append(positions, element)
	}
	lastRequired, firstRest, lastOptionalOrRest := -1, -1, -1
	for i, element := range positions {
		if !element.optional && !element.rest {
			lastRequired = i
		}
		if element.rest && firstRest < 0 {
			firstRest = i
		}
		if element.optional || element.rest {
			lastOptionalOrRest = i
		}
	}
	for i := 0; i < lastRequired; i++ {
		if positions[i].optional {
			positions[i].typ = p.schemaTupleUndefined(positions[i].typ)
			positions[i].optional = false
		}
	}
	if firstRest >= 0 && firstRest < lastOptionalOrRest {
		var types []*ast.Node
		for _, element := range positions[firstRest : lastOptionalOrRest+1] {
			typ := element.typ
			if element.optional {
				typ = p.schemaTupleUndefined(typ)
			}
			types = append(types, typ)
		}
		union := p.schemaTupleUnion(types)
		positions[firstRest] = schemaTuplePosition{typ: union, rest: true}
		positions = append(positions[:firstRest+1], positions[lastOptionalOrRest+1:]...)
	}
	return positions, true, true
}

// vibelangSchemaRestElement extracts the repeated schema type from the array
// spellings supported in a tuple rest position.
func vibelangSchemaRestElement(element *ast.Node) *ast.Node {
	if element == nil {
		return nil
	}
	for element.Kind == ast.KindParenthesizedType {
		element = element.AsParenthesizedTypeNode().Type
	}
	if element.Kind == ast.KindTypeOperator {
		operator := element.AsTypeOperatorNode()
		if operator.Operator == ast.KindReadonlyKeyword && operator.Type.Kind == ast.KindArrayType {
			element = operator.Type
		}
	}
	switch element.Kind {
	case ast.KindArrayType:
		return element.AsArrayTypeNode().ElementType
	case ast.KindTypeReference:
		ref := element.AsTypeReferenceNode()
		if ast.IsIdentifier(ref.TypeName) && (ref.TypeName.Text() == "Array" || ref.TypeName.Text() == "ReadonlyArray") && ref.TypeArguments != nil && len(ref.TypeArguments.Nodes) == 1 {
			return ref.TypeArguments.Nodes[0]
		}
	}
	return nil
}
