package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// The only queried strings are "_tag", its substrings, and their ASCII case
// variants. Numeric, bigint, boolean and symbol domains cannot produce them.
// Opaque brands do not narrow a string's runtime domain, including inside a
// template placeholder or a string-mapping intrinsic (Chapter 3, VIP-29).
func keyDomainMayBeTag(c *checker.Checker, t *checker.Type, depth int) bool {
	return keyDomainMayContainTagText(c, t, "_tag", depth)
}

func keyDomainMayContainTagText(c *checker.Checker, t *checker.Type, text string, depth int) bool {
	if t == nil || depth > 16 {
		return true
	}
	flags := t.Flags()
	switch {
	case flags&checker.TypeFlagsNever != 0:
		return false
	case flags&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0:
		return true
	case t.IsUnion():
		for _, member := range t.Types() {
			if keyDomainMayContainTagText(c, member, text, depth+1) {
				return true
			}
		}
		return false
	case t.IsIntersection():
		for _, member := range t.Types() {
			if member.Flags()&(checker.TypeFlagsPrimitive|checker.TypeFlagsInstantiable) != 0 &&
				!keyDomainMayContainTagText(c, member, text, depth+1) {
				return false
			}
		}
		return true
	case flags&checker.TypeFlagsStringLiteral != 0:
		value, ok := t.AsLiteralType().Value().(string)
		return !ok || value == text
	case flags&(checker.TypeFlagsNumberLike|checker.TypeFlagsESSymbolLike|checker.TypeFlagsBigIntLike|checker.TypeFlagsBooleanLike) != 0:
		return false
	case flags&checker.TypeFlagsTemplateLiteral != 0:
		return keyTemplateMayContainTagText(c, t, text, depth+1)
	case flags&checker.TypeFlagsStringMapping != 0:
		return keyMappingMayContainTagText(c, t, text, depth+1)
	case flags&checker.TypeFlagsInstantiable != 0:
		constraint := c.GetBaseConstraintOfType(t)
		if constraint == nil || constraint == t {
			return true
		}
		return keyDomainMayContainTagText(c, constraint, text, depth+1)
	}
	return true
}

func keyTemplateMayContainTagText(c *checker.Checker, t *checker.Type, text string, depth int) bool {
	template := t.AsTemplateLiteralType()
	parts, holes := template.Texts(), template.Types()
	if len(parts) != len(holes)+1 {
		return true
	}
	if !strings.HasPrefix(text, parts[0]) {
		return false
	}
	text = text[len(parts[0]):]
	// At most five offsets are possible. Memoize empty-hole paths as well,
	// so many branded placeholders do not multiply equivalent partitions.
	type position struct{ hole, offset int }
	memo := map[position]uint8{}
	var match func(int, int) bool
	match = func(hole, offset int) bool {
		if hole == len(holes) {
			return offset == len(text)
		}
		at := position{hole, offset}
		if cached := memo[at]; cached != 0 {
			return cached == 2
		}
		memo[at] = 1
		for end := offset; end <= len(text); end++ {
			if strings.HasPrefix(text[end:], parts[hole+1]) &&
				keyDomainMayContainTagText(c, holes[hole], text[offset:end], depth+1) &&
				match(hole+1, end+len(parts[hole+1])) {
				memo[at] = 2
				return true
			}
		}
		return false
	}
	return match(0, 0)
}

func keyMappingMayContainTagText(c *checker.Checker, t *checker.Type, text string, depth int) bool {
	symbol := t.Symbol()
	if symbol == nil {
		return true
	}
	firstOnly := false
	switch symbol.Name() {
	case "Uppercase":
		if strings.ToUpper(text) != text {
			return false
		}
	case "Lowercase":
		if strings.ToLower(text) != text {
			return false
		}
	case "Capitalize":
		if text != "" && strings.ToUpper(text[:1])+text[1:] != text {
			return false
		}
		firstOnly = true
	case "Uncapitalize":
		if text != "" && strings.ToLower(text[:1])+text[1:] != text {
			return false
		}
		firstOnly = true
	default:
		return true
	}
	// These candidates contain only _, a/A, t/T and g/G. Their JavaScript
	// case-mapping preimages are exactly the corresponding ASCII variants.
	candidates := []string{text}
	for i := 0; i < len(text) && (!firstOnly || i == 0); i++ {
		var other byte
		switch text[i] {
		case 'a', 't', 'g':
			other = text[i] - ('a' - 'A')
		case 'A', 'T', 'G':
			other = text[i] + ('a' - 'A')
		default:
			continue
		}
		count := len(candidates)
		for j := 0; j < count; j++ {
			candidate := []byte(candidates[j])
			candidate[i] = other
			candidates = append(candidates, string(candidate))
		}
	}
	target := t.AsStringMappingType().Target()
	for _, candidate := range candidates {
		if keyDomainMayContainTagText(c, target, candidate, depth+1) {
			return true
		}
	}
	return false
}
