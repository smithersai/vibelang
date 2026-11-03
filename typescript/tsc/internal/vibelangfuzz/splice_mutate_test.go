package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Splicing writes new programs out of real ones, as tree-splicer does for
// rustc and the Kotlin compiler fuzzers do for kotlinc: it replaces a node of
// a recipient file with a node of the same category from a donor. Byte
// mutation of an archive rarely keeps a program parsing, and the
// specification generator writes only the forms it models; a splice keeps
// the code people wrote and puts it in places nobody put it.
//
// The donors are the .vibe sources of the acceptance cases and the
// documentation's snippets, each parsed once with the fork's parser.
// ParseVibeLangSyntax also records each VibeLang form as written, which gives
// match arms and VibeLang declarations their own spans. Function bodies
// come from ordinary function and explicit callback nodes (VIP-11).
//
// The parser writes each VibeLang form as the TypeScript it abbreviates and
// places some synthesized nodes at source spans that are not their syntax: a
// match arm's span on the return statement it becomes, for one. So a node is
// spliced, as recipient or donor, only when its text written alone in a
// context of its category parses back to a node of the same category and
// kind at the same span, without a syntax error (spliceValid). That also
// drops the broken pieces of snippets that are fragments.

// A spliceCategory is a set of nodes that can stand in for each other.
type spliceCategory int

const (
	spliceStatement    spliceCategory = iota // a statement of a statement list
	spliceExpression                         // an expression in an expression position
	spliceType                               // a type node
	spliceClassMember                        // a member of a class body
	spliceObjectMember                       // a member of an object literal
	spliceTypeMember                         // a member of an interface or a type literal
	spliceArm                                // a match arm: when pattern: value, or default: value (D206)
	spliceFunctionBody                       // a native function or explicit callback body (VIP-11)
	spliceDeclaration                        // a top-level declaration, VibeLang's included
	spliceCategories
)

func (c spliceCategory) String() string {
	return [...]string{"statement", "expression", "type", "class member", "object member", "type member", "match arm", "function body", "declaration"}[c]
}

// spliceContexts holds the text before and after a node of each category
// when spliceValid parses it alone.
var spliceContexts = [spliceCategories][2]string{
	spliceStatement:    {"function $splice() {\n", "\n}\n"},
	spliceExpression:   {"(", ")\n"},
	spliceType:         {"type $Splice =\n", "\n"},
	spliceClassMember:  {"class $Splice {\n", "\n}\n"},
	spliceObjectMember: {"({\n", "\n})\n"},
	spliceTypeMember:   {"interface $Splice {\n", "\n}\n"},
	spliceArm:          {"match ($splice) {\n", "\n}\n"},
	spliceFunctionBody: {"function $splice() ", "\n"},
	spliceDeclaration:  {"", "\n"},
}

const (
	// spliceMax is the most splices one input makes.
	spliceMax = 4
	// spliceTries is how many candidates a splice tries, from the one the
	// input chose, before it gives up.
	spliceTries = 8
	// spliceDonorLimit bounds a donor's text, so that a few splices keep a
	// project under Admissible's size.
	spliceDonorLimit = 4 << 10
)

// A spliceNode is one node of a .vibe text that a splice may replace or
// copy: its category, its kind (an ast.Kind, or a VibeLang form's name) and
// its span without leading trivia.
type spliceNode struct {
	category   spliceCategory
	kind       string
	start, end int
}

// spliceNodes parses a .vibe text and returns its nodes by category, in the
// order the tree and the recorded forms give them, and whether the text has a
// syntax error.
func spliceNodes(text string) (nodes [spliceCategories][]spliceNode, syntaxError bool) {
	file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/splice/main.vibe", PathKey: "/splice/main.vibe"}, text)
	seen := map[spliceNode]bool{}
	add := func(n spliceNode) {
		if n.start < 0 || n.start >= n.end || n.end > len(text) || seen[n] {
			return
		}
		seen[n] = true
		nodes[n.category] = append(nodes[n.category], n)
	}
	var visit ast.Visitor
	visit = func(n *ast.Node) bool {
		if n.Pos() >= 0 && n.Pos() <= n.End() && n.End() <= len(text) {
			start := scanner.SkipTrivia(text, n.Pos())
			for _, category := range spliceCategoriesOf(n) {
				add(spliceNode{category, n.Kind.String(), start, n.End()})
			}
			if n.Kind == ast.KindBlock && n.Parent != nil && ast.IsFunctionLike(n.Parent) && n.Parent.Body() == n {
				add(spliceNode{spliceFunctionBody, "function body", start, n.End()})
			}

		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	for _, form := range forms {
		switch form.Kind {
		case parser.VibeSyntaxMatch:
			for _, arm := range form.Arms {
				kind := "when arm"
				if strings.HasPrefix(text[max(0, min(arm.Head.Pos(), len(text))):], "default") {
					kind = "default arm"
				}
				add(spliceNode{spliceArm, kind, arm.Head.Pos(), arm.Value.End()})
			}
		case parser.VibeSyntaxDeclaration:
			add(spliceNode{spliceDeclaration, form.Name + " declaration", form.Range.Pos(), form.Range.End()})
		}
	}
	return nodes, len(file.Diagnostics()) != 0
}

// spliceCategoriesOf returns the categories of a node of the tree.
func spliceCategoriesOf(n *ast.Node) []spliceCategory {
	parent := n.Parent
	if parent == nil {
		return nil
	}
	switch {
	case ast.IsStatement(n) && slices.Contains([]ast.Kind{ast.KindSourceFile, ast.KindBlock, ast.KindModuleBlock, ast.KindCaseClause, ast.KindDefaultClause}, parent.Kind):
		if parent.Kind == ast.KindSourceFile && n.Kind != ast.KindMissingDeclaration && (ast.IsDeclarationStatement(n) || n.Kind == ast.KindVariableStatement) {
			return []spliceCategory{spliceStatement, spliceDeclaration}
		}
		return []spliceCategory{spliceStatement}
	case ast.IsTypeNode(n) && n.Kind != ast.KindExpressionWithTypeArguments:
		return []spliceCategory{spliceType}
	case ast.IsClassElement(n) && ast.IsClassLike(parent) && n.Kind != ast.KindSemicolonClassElement:
		return []spliceCategory{spliceClassMember}
	case ast.IsObjectLiteralElement(n) && parent.Kind == ast.KindObjectLiteralExpression:
		return []spliceCategory{spliceObjectMember}
	case ast.IsTypeElement(n) && (parent.Kind == ast.KindInterfaceDeclaration || parent.Kind == ast.KindTypeLiteral):
		return []spliceCategory{spliceTypeMember}
	case n.Kind != ast.KindOmittedExpression && n.Kind != ast.KindSpreadElement && ast.IsExpressionNode(n):
		return []spliceCategory{spliceExpression}
	}
	return nil
}

// spliceValid reports whether text, written alone in a context of its
// category, parses without a syntax error to a node of that category and
// kind at the same span.
func spliceValid(category spliceCategory, kind, text string) bool {
	before, after := spliceContexts[category][0], spliceContexts[category][1]
	nodes, syntaxError := spliceNodes(before + text + after)
	return !syntaxError && slices.Contains(nodes[category], spliceNode{category, kind, len(before), len(before) + len(text)})
}

// A spliceDonor is one distinct text of the donor pool.
type spliceDonor struct {
	kind, text string
	from       string       // the case or snippet it first came from
	valid      atomic.Int32 // 0 not checked yet, 1 valid, 2 not
}

func (d *spliceDonor) isValid(category spliceCategory) bool {
	switch d.valid.Load() {
	case 1:
		return true
	case 2:
		return false
	}
	if !spliceValid(category, d.kind, d.text) {
		d.valid.Store(2)
		return false
	}
	d.valid.Store(1)
	return true
}

// A splicePool holds every donor text of each category once, in the order
// the cases and snippets give them, and the indexes of each kind's.
type splicePool struct {
	donors [spliceCategories][]*spliceDonor
	byKind [spliceCategories]map[string][]int
}

// spliceDonors parses every .vibe source of the acceptance cases and every
// documentation snippet once.
var spliceDonors = sync.OnceValue(func() *splicePool {
	pool := &splicePool{}
	for c := range spliceCategories {
		pool.byKind[c] = map[string][]int{}
	}
	type key struct {
		category   spliceCategory
		kind, text string
	}
	seen := map[key]bool{}
	for _, seed := range append(slices.Clone(CaseSeeds()), SnippetSeeds()...) {
		for _, name := range slices.Sorted(maps.Keys(seed.Files)) {
			if !strings.HasSuffix(name, ".vibe") {
				continue
			}
			text := seed.Files[name]
			nodes, _ := spliceNodes(text)
			for c, list := range nodes {
				for _, n := range list {
					k := key{spliceCategory(c), n.kind, text[n.start:n.end]}
					if len(k.text) > spliceDonorLimit || seen[k] {
						continue
					}
					seen[k] = true
					pool.byKind[c][n.kind] = append(pool.byKind[c][n.kind], len(pool.donors[c]))
					pool.donors[c] = append(pool.donors[c], &spliceDonor{kind: n.kind, text: k.text, from: seed.Name + ": " + name})
				}
			}
		}
	}
	return pool
})

// A spliceRecipient is a project a splice starts from: an acceptance case,
// with its tsconfig.json and every file, or a snippet as one main.vibe.
type spliceRecipient struct {
	name    string
	project Project
	vibe    []string // its .vibe files, in name order
}

// spliceRecipients are the cases and snippets FuzzCompile takes as seeds,
// with declarations and source maps on, that have a .vibe file and that
// Admissible accepts.
var spliceRecipients = sync.OnceValue(func() []spliceRecipient {
	var recipients []spliceRecipient
	add := func(name string, files map[string]string) {
		project := Project{Files: maps.Clone(files)}
		if config, ok := project.Files["tsconfig.json"]; ok {
			project.Config = withEmitters(config)
			delete(project.Files, "tsconfig.json")
		}
		var vibe []string
		for _, file := range slices.Sorted(maps.Keys(project.Files)) {
			if strings.HasSuffix(file, ".vibe") {
				vibe = append(vibe, file)
			}
		}
		if len(vibe) != 0 && Admissible(project) == "" {
			recipients = append(recipients, spliceRecipient{name, project, vibe})
		}
	}
	for _, seed := range CaseSeeds() {
		add("case "+seed.Name, seed.Files)
	}
	for _, seed := range SnippetSeeds() {
		add("snippet "+seed.Name, seed.Files)
	}
	return recipients
})

// spliceChoices reads an input's decisions from its bytes, in order, so the
// input alone decides every splice and a crasher the fuzzer saves replays
// against the same cases and snippets. A choice past the input's end is 0.
type spliceChoices struct {
	data []byte
}

func (c *spliceChoices) next() byte {
	if len(c.data) == 0 {
		return 0
	}
	b := c.data[0]
	c.data = c.data[1:]
	return b
}

// intn returns a choice in [0, n), reading as many bytes as n needs.
func (c *spliceChoices) intn(n int) int {
	if n <= 1 {
		return 0
	}
	v := 0
	for bound := n - 1; bound > 0; bound >>= 8 {
		v = v<<8 | int(c.next())
	}
	return v % n
}

// A splice is one replacement, as a report names it.
type splice struct {
	file          string
	node          spliceNode
	old, new      string
	donorKind     string
	from          string // the donor's case or snippet, or "" for the recipient's file
	recipientText string // the file before this splice
}

func (s splice) String() string {
	from := s.from
	if from == "" {
		from = "the same file"
	}
	return fmt.Sprintf("%s [%d, %d) %s %s %q replaced by %s %q from %s", s.file, s.node.start, s.node.end, s.node.category, s.node.kind, excerpt(s.old, 0), s.donorKind, excerpt(s.new, 0), from)
}

// spliceProject writes the project a choice input describes: the recipient
// it chooses, with up to spliceMax nodes of its .vibe files each replaced by
// a donor's node of the same category, from the same file or the pool. Its
// other files and its tsconfig.json stay as they are.
func spliceProject(input []byte) (spliceRecipient, Project, []splice) {
	c := &spliceChoices{data: input}
	recipients := spliceRecipients()
	r := recipients[c.intn(len(recipients))]
	files := maps.Clone(r.project.Files)
	var splices []splice
	for range 1 + c.intn(spliceMax) {
		name := r.vibe[c.intn(len(r.vibe))]
		if s, ok := spliceOnce(c, files[name]); ok {
			s.file = name
			files[name] = files[name][:s.node.start] + s.new + files[name][s.node.end:]
			splices = append(splices, s)
		}
	}
	return r, Project{Files: files, Config: r.project.Config}, splices
}

// spliceOnce chooses a category among those text has nodes of, a node of
// that category in text, and a donor node of the same category, of the same
// kind when the input says so, from text itself or the pool.
func spliceOnce(c *spliceChoices, text string) (splice, bool) {
	nodes, _ := spliceNodes(text)
	var categories []spliceCategory // those the text has a node of
	for category := range spliceCategories {
		if len(nodes[category]) != 0 {
			categories = append(categories, category)
		}
	}
	if len(categories) == 0 {
		return splice{}, false
	}
	category := categories[c.intn(len(categories))]
	candidates := nodes[category]
	target, ok := spliceFirst(c, len(candidates), func(i int) bool {
		n := candidates[i]
		return spliceValid(category, n.kind, text[n.start:n.end])
	})
	if !ok {
		return splice{}, false
	}
	node := candidates[target]
	s := splice{node: node, old: text[node.start:node.end], recipientText: text}
	mode := c.intn(4)
	sameKind, own := mode&1 != 0, mode&2 != 0
	if own {
		var donors []spliceNode
		for _, n := range candidates {
			if (!sameKind || n.kind == node.kind) && text[n.start:n.end] != s.old {
				donors = append(donors, n)
			}
		}
		if i, ok := spliceFirst(c, len(donors), func(i int) bool {
			return spliceValid(category, donors[i].kind, text[donors[i].start:donors[i].end])
		}); ok {
			s.new, s.donorKind = text[donors[i].start:donors[i].end], donors[i].kind
			return s, true
		}
	}
	pool := spliceDonors()
	indexes := pool.byKind[category][node.kind]
	if !sameKind || len(indexes) == 0 {
		indexes = nil // the whole category
	}
	count := len(pool.donors[category])
	if indexes != nil {
		count = len(indexes)
	}
	donor := func(i int) *spliceDonor {
		if indexes != nil {
			return pool.donors[category][indexes[i]]
		}
		return pool.donors[category][i]
	}
	i, ok := spliceFirst(c, count, func(i int) bool {
		d := donor(i)
		return d.text != s.old && d.isValid(category)
	})
	if !ok {
		return splice{}, false
	}
	d := donor(i)
	s.new, s.donorKind, s.from = d.text, d.kind, d.from
	return s, true
}

// spliceFirst returns the first of up to spliceTries candidates, from the one
// the input chooses, that ok accepts.
func spliceFirst(c *spliceChoices, n int, ok func(int) bool) (int, bool) {
	if n == 0 {
		return 0, false
	}
	first := c.intn(n)
	for i := range min(spliceTries, n) {
		if j := (first + i) % n; ok(j) {
			return j, true
		}
	}
	return 0, false
}
