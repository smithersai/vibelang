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

// keyDomainSingleString finds a proven singleton string after erasing opaque
// brands. Plain errors reserve a known _tag member, but do not apply the
// schema-error rule that rejects every broad key domain (Chapter 3, VIP-13).
func keyDomainSingleString(c *checker.Checker, t *checker.Type, depth int) (string, bool) {
	if t == nil || depth > 16 {
		return "", false
	}
	flags := t.Flags()
	switch {
	case flags&checker.TypeFlagsStringLiteral != 0:
		value, ok := t.AsLiteralType().Value().(string)
		return value, ok
	case t.IsUnion():
		value := ""
		found := false
		for _, member := range t.Types() {
			next, known := keyDomainSingleString(c, member, depth+1)
			if !known || found && next != value {
				return "", false
			}
			value, found = next, true
		}
		return value, found
	case t.IsIntersection():
		value := ""
		found := false
		for _, member := range t.Types() {
			if next, known := keyDomainSingleString(c, member, depth+1); known {
				if found && next != value {
					return "", false
				}
				value, found = next, true
			}
		}
		if found {
			for _, member := range t.Types() {
				if !keyDomainMayContainTagText(c, member, value, depth+1) {
					return "", false
				}
			}
		}
		return value, found
	case flags&checker.TypeFlagsTemplateLiteral != 0:
		template := t.AsTemplateLiteralType()
		parts, holes := template.Texts(), template.Types()
		if len(parts) != len(holes)+1 {
			return "", false
		}
		value := parts[0]
		for i, hole := range holes {
			part, known := keyDomainSingleString(c, hole, depth+1)
			if !known {
				return "", false
			}
			value += part + parts[i+1]
		}
		return value, true
	case flags&checker.TypeFlagsStringMapping != 0:
		value, known := keyDomainSingleString(c, t.AsStringMappingType().Target(), depth+1)
		if !known || t.Symbol() == nil {
			return "", false
		}
		// ASCII case mappings agree with JavaScript. Other keys need no singleton
		// proof to remain admitted in an ordinary error.
		for _, r := range value {
			if r > 127 {
				return "", false
			}
		}
		switch t.Symbol().Name() {
		case "Uppercase":
			return strings.ToUpper(value), true
		case "Lowercase":
			return strings.ToLower(value), true
		case "Capitalize":
			if value != "" {
				value = strings.ToUpper(value[:1]) + value[1:]
			}
			return value, true
		case "Uncapitalize":
			if value != "" {
				value = strings.ToLower(value[:1]) + value[1:]
			}
			return value, true
		}
	case flags&checker.TypeFlagsInstantiable != 0:
		constraint := c.GetBaseConstraintOfType(t)
		if constraint != nil && constraint != t {
			return keyDomainSingleString(c, constraint, depth+1)
		}
	}
	return "", false
}
