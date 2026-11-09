package vibelang

import "slices"

// applyEdits applies edits, which do not overlap, to text.
func applyEdits(text string, edits []sourceEdit) string {
	edits = slices.Clone(edits)
	slices.SortFunc(edits, func(a, b sourceEdit) int { return b.start - a.start })
	for _, e := range edits {
		text = text[:e.start] + e.text + text[e.end:]
	}
	return text
}
