package vibelangmapper

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
)

// The lowering plan of one file is a list of edits to its text. The walk
// records each edit once, as what it means rather than as text; a rendering
// maps each edit to text. Two renderings share the plan:
//
//   - the checking rendering, the virtual TypeScript that stock tsc checks;
//   - the executable rendering, the code the compiler emits, which runs a
//     call by a run-time test where the checking rendering has $run's
//     types, splits a plain function into f$direct and an Effect wrapper
//     (D10), and never applies a checker-only witness, such as the second
//     call of a type guard in `((yield* $run(g(x))), g(x))`.
//
// This phase implements the checking rendering. The executable rendering
// is a placeholder that drops witnesses and implements no other kind; the
// plan carries no checking-only text it would have to undo.

// editKind is what an edit means. Kinds come in parts: an open and a close
// edit around source text, and sometimes a middle one.
type editKind uint8

const (
	// editSyntax rewrites syntax the same way in both renderings: a
	// keyword, punctuation, or a declaration's shape. Its text names
	// helpers as helperRef writes them.
	editSyntax editKind = iota
	editSettledCall
	editSettledMap
	editSettledElement
	// editWitness is checker-only text, which the executable rendering drops.
	editWitness
	// editRun runs a call where it stands (L3).
	editRun
	// editEffectBody makes a function's body an Effect: its generator. The
	// arg "self" passes this to the generator.
	editEffectBody
	// editContract checks a body against a contract with an infer channel (D57).
	editContract
	// editProgram makes a block a program: an Effect value whose generator
	// runs the block when the Effect runs (D7).
	editProgram
	// editFail fails with a thrown value (D46).
	editFail
	// editServiceCall reads a member call's receiver as a possible service key (D41).
	editServiceCall
	// editValueCall calls a value with no arguments, which runs an Effect value (D90).
	editValueCall
	// editBuiltinCall supplies the shipped failure contract of a caught built-in.
	editBuiltinCall
	// editPlainCall selects a D54 synchronous entry in a plain callback.
	editPlainCall
	// editRegion runs a block of an Effect function as an Effect of its own:
	// arg names the region's helper chain and completion variable.
	editRegion
	// editRecord is a completion record a region's block returns: a return,
	// break, or continue that leaves the region, or its normal end.
	editRecord
	// editDispatch acts on a region's completion record after it runs.
	editDispatch
	// editUsing acquires a using declaration's value in the block's Scope
	// (D47, D94): its initializer, passed by name.
	editUsing
	// editDual makes a parameterless lambda's program also a function that
	// returns it (L1's dual form).
	editDual
	// editScoped is a fork in a block, whose Scope owns the fiber (D19).
	editScoped
	// editProgramValue converts a function value at a program position to
	// its program (D7).
	editProgramValue
	// editProducer makes a generator function's body a producer, a Stream (D26).
	editProducer
	// editEmit is a producer's yield: it emits a value, or with arg
	// "delegate" every element of another producer.
	editEmit
	// editEach iterates a for...of's value: a Stream's elements, or an
	// iterable as itself (D26).
	editEach
	// editServiceBase is a service class's key (D45): fields are "service"
	// or "reference" (D40), the key, and the class's name. A service of any
	// shape (D281) has an open and a close part around the written shape.
	editServiceBase
	// editControl registers a control's operations (D2): fields are the
	// control's name, then each operation's name and arity, -1 for a rest
	// parameter. The checking rendering writes nothing.
	editControl
	// editScopeRegion is a block that holds a using or a fork, a region of
	// its own under $scopedBody (regions.go, scopeBlock), whose Scope ends
	// with the block (D14, D19). Both renderings write its text.
	editScopeRegion
	// editHatch carries the checking and executable spelling of a hatch boundary.
	editHatch
	// editDataMethod retains checking syntax and dispatches unproven receivers in execution.
	// A closing fragment's fields name the method whose candidates execution imports.
	editDataMethod
	// editRegionVar hoists storage, with a checker-only type witness.
	editRegionVar
	// editPatternFlow gives stock TypeScript the subject/tuple relationship
	// guaranteed by D215, while execution retains the parser's original test.
	editPatternFlow
)

// part says which part of a kind an edit is.
type part uint8

const (
	partOpen part = iota
	partMiddle
	partClose
	// partWhole is an edit of a kind that stands alone, such as a dispatch.
	partWhole
)

// edit replaces the original text in [pos, end) with what kind and part
// mean. An edit with pos == end inserts before the original character at pos.
type edit struct {
	pos  int
	end  int
	kind editKind
	part part
	// text is an editSyntax or editWitness edit's text, and the rendered
	// form of kinds whose text the walk computes (regions, records,
	// dispatches), in checking form.
	text string
	// arg is a kind-specific argument.
	arg string
	// pair identifies the edits of one construct: an open, its middles,
	// and its close share it, so a rendering never pairs them by order.
	// An edit that stands alone has 0.
	pair int
	// fields are a kind's structured data, for the renderings to write
	// from: a service base's key and name, a control's operations.
	fields []string
}

// helperRef writes a reference to a projection helper in edit text. Each
// rendering resolves it: the checking rendering to the prelude helper's
// local name.
func helperRef(name string) string { return "\x01" + name + "\x02" }

// plan is the lowering plan of one file.
type plan struct {
	edits []edit
	// open holds, per kind, the pair ids of the constructs opened and not
	// yet closed, innermost last. Each kind's edits nest in the order the
	// walk records them, so the stack pairs them.
	open  map[editKind][]int
	pairs int
}

// pairFor returns the pair id of a new edit of kind and part.
func (l *plan) pairFor(kind editKind, p part) int {
	if p == partWhole || kind == editSyntax || kind == editWitness {
		return 0
	}
	if l.open == nil {
		l.open = map[editKind][]int{}
	}
	stack := l.open[kind]
	switch p {
	case partOpen:
		l.pairs++
		l.open[kind] = append(stack, l.pairs)
		return l.pairs
	case partMiddle:
		if len(stack) == 0 {
			return 0
		}
		return stack[len(stack)-1]
	default:
		if len(stack) == 0 {
			return 0
		}
		l.open[kind] = stack[:len(stack)-1]
		return stack[len(stack)-1]
	}
}

// unclosed reports the kinds with a construct opened and never closed, a
// projector bug.
func (l *plan) unclosed() []editKind {
	var kinds []editKind
	for kind, stack := range l.open {
		if len(stack) > 0 {
			kinds = append(kinds, kind)
		}
	}
	return kinds
}

// insert records syntax text to insert before the original character at pos.
func (l *plan) insert(pos int, text string) {
	l.edits = append(l.edits, edit{pos: pos, end: pos, text: text})
}

// replace records syntax text to replace the original text in [pos, end).
func (l *plan) replace(pos int, end int, text string) {
	l.edits = append(l.edits, edit{pos: pos, end: end, text: text})
}

// witness records checker-only text to insert before the original
// character at pos.
func (l *plan) witness(pos int, text string) {
	l.edits = append(l.edits, edit{pos: pos, end: pos, kind: editWitness, text: text})
}

// mark records an edit of kind at [pos, end), with arg.
func (l *plan) mark(kind editKind, p part, pos int, end int, arg string) {
	l.edits = append(l.edits, edit{pos: pos, end: end, kind: kind, part: p, arg: arg, pair: l.pairFor(kind, p)})
}

// markText records an edit of kind at [pos, end) whose checking text the
// walk computed.
func (l *plan) markText(kind editKind, p part, pos int, end int, text string) {
	l.edits = append(l.edits, edit{pos: pos, end: end, kind: kind, part: p, text: text, pair: l.pairFor(kind, p)})
}

// reserve records an edit of kind at [pos, end) whose text the walk sets
// later, through the returned index: an edit that must apply before the
// edits a nested construct records at the same position.
func (l *plan) reserve(kind editKind, p part, pos int, end int) int {
	l.edits = append(l.edits, edit{pos: pos, end: end, kind: kind, part: p, pair: l.pairFor(kind, p)})
	return len(l.edits) - 1
}

// markFields records an edit of kind at [pos, end) with structured fields.
func (l *plan) markFields(kind editKind, p part, pos int, end int, fields ...string) {
	l.edits = append(l.edits, edit{pos: pos, end: end, kind: kind, part: p, fields: fields, pair: l.pairFor(kind, p)})
}

// rendering maps a plan's edits to text.
type rendering interface {
	// text returns the text of e, or ok false to leave e out.
	text(e edit) (text string, ok bool)
}

// checking is the checking rendering, the virtual TypeScript.
type checking struct {
	names *names
}

func (r checking) text(e edit) (string, bool) {
	var text string
	switch e.kind {
	case editPatternFlow:
		text = e.fields[0]
	case editSettledCall:
		text = pick(e.part, helperRef("Effect")+".all(", "", ", { concurrency: \"unbounded\" })")
	case editSettledMap:
		if e.arg == "spread" {
			text = pick(e.part, "([...(", "", ")].map("+helperRef("Effect")+".exit))")
		} else {
			text = pick(e.part, "(", "", ").map("+helperRef("Effect")+".exit)")
		}
	case editSettledElement:
		text = pick(e.part, helperRef("Effect")+".exit(", "", ")")
	case editSyntax, editWitness, editRegion, editDispatch:
		text = e.text
	case editRegionVar:
		text = e.fields[0]
	case editHatch, editDataMethod:
		text = e.text
	case editRecord:
		switch e.arg {
		case "return value":
			// return x in a region returns $box(x) (regions.go).
			text = pick(e.part, "return "+helperRef("$box")+"(", "", ")")
		case "return":
			// return without a value stays.
		default:
			text = e.text
		}
	case editRun:
		if e.arg == "return" {
			text = pick(e.part, "(yield* "+helperRef("$returnRun")+"(", "", "))")
		} else if strings.HasPrefix(e.arg, "channels ") {
			text = pick(e.part, "(yield* "+helperRef("$runAt")+"(", "", ", "+strings.TrimPrefix(e.arg, "channels ")+"))")
		} else {
			text = pick(e.part, "(yield* "+helperRef("$run")+"(", "", "))")
		}
	case editEffectBody:
		gen := helperRef("$gen") + "(function* () "
		if strings.Contains(e.arg, "self") {
			gen = helperRef("$gen") + "({ self: this }, function* () "
		}
		switch {
		case strings.HasPrefix(e.arg, "expr"):
			// (x) => expr
			text = pick(e.part, gen+"{ return ", "", " })")
		case strings.HasPrefix(e.arg, "block"):
			// a block param in the Effect function form
			text = pick(e.part, "() => "+gen, "", ")")
		default:
			// a function's braced body
			text = pick(e.part, " return "+gen+"{", "", "})")
		}
	case editContract:
		gen := helperRef("$gen") + "(function* () "
		if e.arg == "self" {
			gen = helperRef("$gen") + "({ self: this }, function* () "
		}
		arrow := ""
		if arg, ok := strings.CutSuffix(e.arg, lintArrowSuffix); ok {
			arrow = " =>"
			if arg == "self" {
				gen = helperRef("$gen") + "({ self: this }, function* () "
			}
		}
		text = pick(e.part, arrow+" { return "+helperRef("$contract")+"<", ">()("+gen, "))}")
	case editProgram:
		gen := helperRef("$gen") + "(function* () "
		if strings.Contains(e.arg, "self") {
			gen = helperRef("$gen") + "({ self: this }, function* () "
		}
		if strings.HasPrefix(e.arg, "expr") {
			text = pick(e.part, gen+"{ return ", "", " })")
		} else {
			text = pick(e.part, gen, "", ")")
		}
	case editDual:
		text = pick(e.part, helperRef("$dual")+"(", "", ")")
	case editScoped:
		// The checking-only scoped signature is selected on the callee.
		text = ""
	case editProgramValue:
		helper := "$asProgram"
		if e.arg == "collection" {
			helper = "$programs"
		} else if e.arg == "plain" {
			helper = "$sync"
		}
		text = pick(e.part, helperRef(helper)+"(", "", ")")
	case editProducer:
		open := " return " + helperRef("$produce") + "(function* () {"
		if e.arg == "self" {
			open = " return " + helperRef("$produce") + "({ self: this }, function* () {"
		}
		text = pick(e.part, open, "", "})")
	case editEmit:
		switch e.arg {
		case "delegate":
			text = pick(e.part, helperRef("$delegate")+"(", "", ")")
		case "undefined":
			text = " " + helperRef("$emit") + "(undefined)"
		default:
			text = pick(e.part, helperRef("$emit")+"(", "", ")")
		}
	case editEach:
		helper := "$each"
		if e.arg == "stream" {
			helper = "$eachStream"
		}
		text = pick(e.part, "(yield* "+helperRef(helper)+"(", "", "))")
	case editServiceBase:
		base, key, name := e.fields[0], e.fields[1], e.fields[2]
		switch e.part {
		case partOpen:
			// service Name: Type (D281): the written shape follows.
			text = serviceShapeBaseOpen(base, name)
		case partClose:
			text = ">(" + strconv.Quote(key) + ")"
		default:
			text = helperRef("$"+base) + "<" + name + ">(" + strconv.Quote(key) + ")"
		}
	case editScopeRegion:
		text = e.text
	case editControl:
		// Nothing to check: the registration only runs.
	case editFail:
		if e.arg == "void" {
			text = pick(e.part, "return (yield* "+helperRef("$fail")+"(", "", ")) as void")
		} else {
			text = pick(e.part, "return yield* "+helperRef("$fail")+"(", "", ")")
		}
	case editServiceCall:
		text = pick(e.part, helperRef("$use")+"(", "", ")")
	case editPlainCall:
		text = pick(e.part, helperRef("$plain")+"(", "", ")")
	case editBuiltinCall:
		text = renderBuiltinCall(e)
	case editValueCall:
		text = renderValueCall(e)
	case editUsing:
		text = pick(e.part, "(yield* "+helperRef("$acquire")+"(", "", "))")
	}
	return r.resolve(text), true
}

// resolve replaces each helper reference in text with the helper's local name.
func (r checking) resolve(text string) string {
	for {
		start := strings.IndexByte(text, '\x01')
		if start < 0 {
			return text
		}
		end := strings.IndexByte(text[start:], '\x02')
		if end < 0 {
			return text
		}
		end += start
		text = text[:start] + r.names.helper(text[start+1:end]) + text[end+1:]
	}
}

// String names k, as reports and the executable rendering's errors do.
func (k editKind) String() string {
	return [...]string{"syntax", "witness", "run", "effect body", "contract", "program", "fail", "service call",
		"value call", "region", "record", "dispatch", "using", "dual", "scoped", "program value", "producer", "emit", "each", "service base", "control", "scope region", "hatch", "data method", "region var", "pattern flow"}[k]
}

// executable is the executable rendering, a placeholder: it leaves out
// checker-only witnesses and implements no other kind yet.
type executable struct{}

func (executable) text(e edit) (string, bool) {
	if e.kind == editWitness {
		return "", false
	}
	return renderExec(e)
}

// pick returns the text of part p among open, middle, and close.
func pick(p part, open, middle, close string) string {
	switch p {
	case partOpen:
		return open
	case partMiddle:
		return middle
	}
	return close
}

// render applies the plan's edits to original, after prefix, text that
// comes before every edit. Edits are sorted by position, stably, so edits
// at one position apply in the order the walk recorded them: an outer run
// opens before an inner one and closes after it. Each stretch of original
// text between edits is copied verbatim and gets a Verbatim segment with
// every language feature; rendered text is synthesized and gets none. ok
// is false when two edits overlap, a projector bug; the caller then passes
// the file through unchanged.
func (l *plan) render(r rendering, original string, prefix func() string) (text string, segments []spanmap.Segment, overlap int, ok bool) {
	edits := slices.Clone(l.edits)
	slices.SortStableFunc(edits, func(a, b edit) int { return cmp.Compare(a.pos, b.pos) })
	var body strings.Builder
	cursor := 0
	for _, e := range edits {
		if e.pos < cursor || e.end < e.pos || e.end > len(original) {
			// Missing parser-recovery nodes can have synthetic (-1) ranges.
			// Reject these before advancing the cursor or slicing source text,
			// and keep the diagnostic inside the original file.
			return "", nil, min(max(e.pos, 0), len(original)), false
		}
		segments = appendVerbatim(segments, &body, original, cursor, e.pos)
		if t, keep := r.text(e); keep {
			body.WriteString(t)
		}
		cursor = e.end
	}
	segments = appendVerbatim(segments, &body, original, cursor, len(original))
	// The prefix is computed after the edits, because rendering them
	// records which helpers the prefix imports.
	head := prefix()
	for i := range segments {
		segments[i].VirtualStart += core.TextPos(len(head))
		segments[i].VirtualEnd += core.TextPos(len(head))
	}
	return head + body.String(), segments, 0, true
}

// appendVerbatim copies original[from:to] to out and appends its Verbatim
// segment, merged into the previous segment when the two are contiguous in
// both texts.
func appendVerbatim(segments []spanmap.Segment, out *strings.Builder, original string, from int, to int) []spanmap.Segment {
	if to <= from {
		return segments
	}
	virtualStart := core.TextPos(out.Len())
	out.WriteString(original[from:to])
	if n := len(segments); n > 0 && segments[n-1].VirtualEnd == virtualStart && segments[n-1].OriginalEnd == core.TextPos(from) {
		segments[n-1].VirtualEnd = core.TextPos(out.Len())
		segments[n-1].OriginalEnd = core.TextPos(to)
		return segments
	}
	return append(segments, spanmap.Segment{
		VirtualStart:  virtualStart,
		VirtualEnd:    core.TextPos(out.Len()),
		OriginalStart: core.TextPos(from),
		OriginalEnd:   core.TextPos(to),
		Kind:          spanmap.KindVerbatim,
		Features:      spanmap.FeatureAll,
	})
}

// serviceShapeBaseOpen is the text before the shape of a service of any
// shape (D281): $service<Name, , or $reference< for a static default, whose
// identifier is never.
func serviceShapeBaseOpen(base, name string) string {
	if base == "reference" {
		return helperRef("$reference") + "<"
	}
	return helperRef("$service") + "<" + name + ", "
}
