package ast

// VibeLangDoSites maps, in a .vibe source file, each variable declaration the
// parser writes for a do expression's completion value
// (NodeFlagsVibeLangDoCompletion) to the reference that stands where the do
// expression was: the site whose contextual type the completion's assignments
// take (parser vibelang_do.go, checker getContextualTypeForBinaryOperand).
var VibeLangDoSites = NewSourceFileDataKey[map[*Node]*Node]()
