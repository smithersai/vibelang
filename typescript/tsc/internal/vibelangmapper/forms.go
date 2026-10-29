package vibelangmapper

// The forms table (language change L1, research/typedirected.md section 6).
// The projector reads no types, so it cannot ask the checker which form a
// lambda takes (D56), whether an argument is passed by name (D147), or what
// a value converts to (D7, D49). It asks this
// table instead. cmd/vibelang-forms generates it from the declarations of the
// packages VibeLang pins (effect@4.1.0, the @effect/* packages the corpus uses,
// and vibelang-runtime) with the fork's own classifier, the code that makes
// those decisions in internal/vibelang. scripts/check-forms-table.sh fails when
// the committed table differs from a fresh one. Never edit forms_table.jsonl.
//
// The table is keyed by callee: a module path, #, and an export path, as in
// effect/Effect#forEach or @effect/vitest#it.effect. Each key holds the
// callee's call signatures in declaration order. A signature records its
// arity and, per parameter, the Class of the declared, uninstantiated type at
// the top level, for an array element, and for each object property. Aliases
// map the other names of a module or export to the canonical key:
// effect#Effect is the module effect/Effect, prelude#forEach is
// effect/Effect#forEach (D151), prelude#wire is vibelang-runtime#wire.
//
// A callee is absent when none of its parameters carries a form: a lambda or
// a call passed to it takes the defaults (forms_resolve.go), as for a callee
// the table does not cover.
//
// Methods of values are keyed by receiver: method:lib/Array#map for the
// lib's arrays, method:effect/Semaphore#withPermits for a member of
// effect/Semaphore's main type, Semaphore. A value of a method module's data
// type (Header.MethodModules, D152) also takes the module's self-first
// functions: stream.flatMap(f) is effect/Stream#flatMap(stream, f).

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
)

//go:embed forms_table.jsonl
var embeddedTable []byte

// Class is the set of forms a parameter position accepts, as the fork's
// classifier reads its declared type. A union of an Effect and a function
// type accepts both (D39).
type Class uint8

const (
	// ClassProgram accepts an Effect value.
	ClassProgram Class = 1 << iota
	// ClassEffectFn accepts a function that returns an Effect.
	ClassEffectFn
	// ClassPlainFn accepts a function that returns something else.
	ClassPlainFn
)

// String writes c as the table does: P, E, and F in that order, or "".
func (c Class) String() string {
	s := ""
	if c&ClassProgram != 0 {
		s += "P"
	}
	if c&ClassEffectFn != 0 {
		s += "E"
	}
	if c&ClassPlainFn != 0 {
		s += "F"
	}
	return s
}

// ParseClass reads a Class written as String writes it.
func ParseClass(s string) (Class, error) {
	var c Class
	for _, r := range s {
		switch r {
		case 'P':
			c |= ClassProgram
		case 'E':
			c |= ClassEffectFn
		case 'F':
			c |= ClassPlainFn
		default:
			return 0, fmt.Errorf("forms: bad class %q", s)
		}
	}
	return c, nil
}

// Has reports whether c accepts every form in other.
func (c Class) Has(other Class) bool { return c&other == other && other != 0 }

// Param is what one declared parameter accepts.
type Param struct {
	// Top is the class of the argument itself.
	Top Class
	// Elem is the class of an element of an array argument, as in
	// Effect.all([a, b]) (D49).
	Elem Class
	// Props is the class of each named property of an object argument, as
	// in Effect.match(self, { onSuccess, onFailure }).
	Props map[string]Class
	// AnyProp is the class of a property Props does not name: the
	// parameter type's string index signature, as in Effect.all({ a, b }).
	AnyProp Class
}

// IsZero reports whether p carries no form anywhere.
func (p Param) IsZero() bool {
	return p.Top == 0 && p.Elem == 0 && len(p.Props) == 0 && p.AnyProp == 0
}

// At returns the class at the steps below the argument: none for the
// argument itself, then an array element or an object property. Deeper
// paths carry no class.
func (p Param) At(steps []PathStep) Class {
	switch len(steps) {
	case 0:
		return p.Top
	case 1:
		if steps[0].Element {
			return p.Elem
		}
		if c, ok := p.Props[steps[0].Property]; ok {
			return c
		}
		return p.AnyProp
	}
	return 0
}

// Equal reports whether p and q record the same classes.
func (p Param) Equal(q Param) bool {
	if p.Top != q.Top || p.Elem != q.Elem || p.AnyProp != q.AnyProp || len(p.Props) != len(q.Props) {
		return false
	}
	for k, v := range p.Props {
		if w, ok := q.Props[k]; !ok || w != v {
			return false
		}
	}
	return true
}

// Signature is one call signature of a callee.
type Signature struct {
	// Min is the number of required parameters; Max the number declared.
	Min, Max int
	// Rest reports whether the last declared parameter is a rest parameter.
	Rest bool
	// Params holds each declared parameter, without trailing ones that
	// carry no form.
	Params []Param
	// DataFirst reports whether the first parameter is an Effect: the
	// data-first form of an Effect dual.
	DataFirst bool
	// DataLast reports whether the result is a function whose first
	// parameter is an Effect: the data-last form of an Effect dual.
	DataLast bool
	// Self reports whether the first parameter is named self (or ends in
	// OrOptions): effect's data-first form, which D152 offers as a method of
	// the module's data type with that parameter as the receiver.
	Self bool
	// Result is the module whose type the signature returns, when that
	// module's values have methods: effect/Stream for Stream.make.
	Result string
	// Runs is, for a signature that returns an Effect, the module of the
	// Effect's success type, which a call that runs produces:
	// effect/Semaphore for Semaphore.make.
	Runs string
}

// Accepts reports whether s takes argc arguments.
func (s Signature) Accepts(argc int) bool {
	return argc >= s.Min && (s.Rest || argc <= s.Max)
}

// Param returns what s's parameter for argument i accepts. A rest
// parameter answers for every argument from its position on.
func (s Signature) Param(i int) Param {
	if s.Rest && i >= s.Max-1 {
		i = s.Max - 1
	}
	if i >= 0 && i < len(s.Params) {
		return s.Params[i]
	}
	return Param{}
}

// Forms is the table's answer for one callee called with argc arguments.
type Forms struct {
	// Callee is the canonical key the answer comes from.
	Callee string
	// Argc is the argument count asked for.
	Argc int
	// Candidates are the signatures that take Argc arguments, the one that
	// requires the most arguments first (a dual's data-first form once its
	// data is there, as effect's own dual(arity) decides), then in
	// declaration order.
	Candidates []Signature
	// Params holds, for each argument, its Param when every candidate
	// agrees, else the first candidate's; Agree says which.
	Params []Param
	// Agree reports, per argument, whether every candidate gives it the
	// same Param.
	Agree []bool
}

// Agreed reports whether every candidate agrees on every argument, so
// Params is the answer without looking at the arguments. When they
// disagree, the projector calls Resolver.Lambda or Resolver.Argument, which
// drop the candidates the written arguments rule out (shapeFit) and take
// the first one left; the decision then carries Ambiguous.
func (f Forms) Agreed() bool { return !slices.Contains(f.Agree, false) }

// RulesVersion numbers the rules that turn declarations into the table and
// the table into decisions: the fork's classifier (vibelang.FormsOfType), the
// generator (cmd/vibelang-forms), and the resolver (forms_resolve.go). Bump it
// in any change that moves a decision, so a table change says whether its
// inputs or its rules moved; scripts/check-forms-table.sh checks the
// decisions themselves.
const RulesVersion = 9

// Header is the table's first line: what generated it, from what.
type Header struct {
	// Notice is "generated; do not edit".
	Notice string `json:"generated"`
	// Command regenerates the table, from the repository root.
	Command string `json:"command"`
	// Rules is the RulesVersion the table was generated under.
	Rules int `json:"rules"`
	// Inputs are the declaration packages the table was generated from.
	Inputs []Input `json:"inputs"`
	// Modules counts the module specifiers the generator walked; the
	// table lists them, one {"module":m} line each.
	Modules int `json:"modules"`
	// MethodModules are the modules whose data types take their self-first
	// functions as methods (D152), as module paths.
	MethodModules []string `json:"methodModules,omitempty"`
	// Keys and Aliases count the table's entries.
	Keys    int `json:"keys"`
	Aliases int `json:"aliases"`
}

// Input pins one declaration package by version and by PackageDigest.
type Input struct {
	Package string `json:"package"`
	Version string `json:"version"`
	// Files is how many files the digest covers.
	Files int `json:"files"`
	// SHA256 is PackageDigest's sum.
	SHA256 string `json:"sha256"`
}

// PackageDigest hashes a declaration input: its package.json and every
// .d.ts file under dir, or with sources every .ts file, outside nested
// node_modules, by path relative to dir and contents, in path order. It
// returns the number of files and the hex SHA-256.
func PackageDigest(dir string, sources bool) (int, string, error) {
	var paths []string
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path != dir && d.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		rel, _ := filepath.Rel(dir, path)
		rel = filepath.ToSlash(rel)
		switch {
		case rel == "package.json" && !sources,
			sources && strings.HasSuffix(rel, ".ts"),
			!sources && strings.HasSuffix(rel, ".d.ts"):
			paths = append(paths, rel)
		}
		return nil
	})
	if err != nil {
		return 0, "", err
	}
	slices.Sort(paths)
	h := sha256.New()
	for _, rel := range paths {
		data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
		if err != nil {
			return 0, "", err
		}
		io.WriteString(h, rel)
		h.Write([]byte{0})
		h.Write(data)
		h.Write([]byte{0})
	}
	return len(paths), hex.EncodeToString(h.Sum(nil)), nil
}

// Table is a parsed forms table.
type Table struct {
	Header  Header
	modules []string
	entries map[string][]Signature
	aliases map[string]string
	values  map[string]string // value export -> the module of its type, when it has methods

	methodOnce sync.Once
	methods    map[string][]methodReceiver // method name -> receivers
}

// NewTable returns a table that holds entries and aliases. An alias maps a
// key, or a module path without #, to its canonical key or module path.
func NewTable(header Header, entries map[string][]Signature, aliases map[string]string) *Table {
	return &Table{Header: header, entries: entries, aliases: aliases, values: map[string]string{}}
}

// SetValues records, for value exports such as effect/Stream#never, the
// module whose type they have, when that module's values have methods.
func (t *Table) SetValues(values map[string]string) { t.values = values }

// Modules returns the module specifiers the table covers, sorted.
func (t *Table) Modules() []string { return t.modules }

// SetModules records the module specifiers the table covers.
func (t *Table) SetModules(modules []string) { t.modules = modules }

// Values returns the value exports SetValues recorded.
func (t *Table) Values() map[string]string { return t.values }

// ValueModule returns the module of the type of the value export callee
// names, after aliases, or "".
func (t *Table) ValueModule(callee string) string {
	if m, ok := t.values[callee]; ok {
		return m
	}
	return t.values[t.Canonical(callee)]
}

var (
	defaultTableOnce sync.Once
	defaultTable     *Table
	defaultTableErr  error
)

// DefaultTable returns the embedded table.
func DefaultTable() (*Table, error) {
	defaultTableOnce.Do(func() {
		defaultTable, defaultTableErr = readTable(embeddedTable)
	})
	return defaultTable, defaultTableErr
}

// FormsFor returns the embedded table's answer for callee called with argc
// arguments. callee is a key as the projector writes it from scope alone
// (effect#Effect.forEach, prelude#forEach, effect/Effect#forEach); aliases
// lead it to the canonical key. It reports false when the table has no
// entry for callee or none of its signatures takes argc arguments.
func FormsFor(callee string, argc int) (Forms, bool) {
	t, err := DefaultTable()
	if err != nil {
		return Forms{}, false
	}
	return t.FormsFor(callee, argc)
}

// FormsFor is the package function FormsFor over t.
func (t *Table) FormsFor(callee string, argc int) (Forms, bool) {
	key, sigs, ok := t.Lookup(callee)
	if !ok {
		return Forms{}, false
	}
	f := Forms{Callee: key, Argc: argc}
	for _, s := range sigs {
		if s.Accepts(argc) {
			f.Candidates = append(f.Candidates, s)
		}
	}
	if len(f.Candidates) == 0 {
		return Forms{}, false
	}
	slices.SortStableFunc(f.Candidates, func(a, b Signature) int { return b.Min - a.Min })
	f.Params = make([]Param, argc)
	f.Agree = make([]bool, argc)
	for i := range argc {
		f.Params[i] = f.Candidates[0].Param(i)
		f.Agree[i] = true
		for _, s := range f.Candidates[1:] {
			if !s.Param(i).Equal(f.Params[i]) {
				f.Agree[i] = false
			}
		}
	}
	return f, true
}

// Lookup returns the canonical key and the signatures the table holds for
// callee, following aliases.
func (t *Table) Lookup(callee string) (string, []Signature, bool) {
	key := callee
	for range 8 {
		if sigs, ok := t.entries[key]; ok {
			return key, sigs, true
		}
		next, ok := t.resolveAlias(key)
		if !ok || next == key {
			return "", nil, false
		}
		key = next
	}
	return "", nil, false
}

// Canonical returns the canonical key for callee after aliases, whether or
// not the table has an entry for it.
func (t *Table) Canonical(callee string) string {
	key := callee
	for range 8 {
		next, ok := t.resolveAlias(key)
		if !ok || next == key {
			return key
		}
		key = next
	}
	return key
}

// resolveAlias rewrites the longest prefix of key that names an alias:
// module#a.b.c tries module#a.b.c, module#a.b, module#a, then module.
func (t *Table) resolveAlias(key string) (string, bool) {
	hash := strings.IndexByte(key, '#')
	if hash < 0 {
		return "", false
	}
	module, path := key[:hash], key[hash+1:]
	var parts []string
	if path != "" {
		parts = strings.Split(path, ".")
	}
	for i := len(parts); i >= 0; i-- {
		name := module
		if i > 0 {
			name = module + "#" + strings.Join(parts[:i], ".")
		}
		target, ok := t.aliases[name]
		if !ok {
			continue
		}
		rest := strings.Join(parts[i:], ".")
		switch {
		case !strings.Contains(target, "#"): // a module
			return target + "#" + rest, true
		case rest == "":
			return target, true
		default:
			return target + "." + rest, true
		}
	}
	return "", false
}

// methodReceivers returns, for a method name, the receivers that have it:
// each one's key prefix and signatures, and whether the signatures take the
// receiver as their first argument (D152's self-first functions).
func (t *Table) methodReceivers(name string) []methodReceiver {
	t.methodOnce.Do(func() {
		t.methods = map[string][]methodReceiver{}
		own := map[string]bool{}
		for key, sigs := range t.entries {
			rest, ok := strings.CutPrefix(key, "method:")
			if !ok {
				continue
			}
			receiver, method, ok := strings.Cut(rest, "#")
			if !ok {
				continue
			}
			own[receiver+"#"+method] = true
			t.methods[method] = append(t.methods[method], methodReceiver{receiver: receiver, sigs: sigs})
		}
		modules := map[string]bool{}
		for _, m := range t.Header.MethodModules {
			modules[m] = true
		}
		for key, sigs := range t.entries {
			module, method, ok := strings.Cut(key, "#")
			if !ok || !modules[module] || strings.Contains(method, ".") || own[module+"#"+method] {
				continue
			}
			var self []Signature
			for _, s := range sigs {
				if s.Self {
					self = append(self, s)
				}
			}
			if len(self) > 0 {
				t.methods[method] = append(t.methods[method], methodReceiver{receiver: module, sigs: self, self: true})
			}
		}
		for _, rs := range t.methods {
			slices.SortFunc(rs, func(a, b methodReceiver) int { return strings.Compare(a.receiver, b.receiver) })
		}
	})
	return t.methods[name]
}

// methodReceiver is one receiver that has a method.
type methodReceiver struct {
	receiver string
	sigs     []Signature
	self     bool // the signatures take the receiver first (D152)
}

// Keys returns the table's keys, sorted.
func (t *Table) Keys() []string {
	keys := make([]string, 0, len(t.entries))
	for k := range t.entries {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

// Signatures returns the signatures under the canonical key, or nil.
func (t *Table) Signatures(key string) []Signature { return t.entries[key] }

// Aliases returns the table's aliases.
func (t *Table) Aliases() map[string]string { return t.aliases }

// The file format: JSON lines. The first line is the Header. Then one line
// per walked module, {"module":m}, sorted, one line per alias, {"alias":name,"to":target}, sorted by name, and one line per
// value export whose type's module has methods, {"value":key,"module":m},
// sorted, and one line per key, {"key":key,"sigs":[signature...]}, sorted by
// key. A signature is {"n":arity,"p":[param...],"df":1,"dl":1,"sf":1,"r":m}:
// arity "2" or "1-3", with "+" for a rest parameter ("1-2+"); a param is ""
// or a class string when only its top level has a class, else
// {"t":top,"e":elem,"p":{name:class},"a":any}; r is Result, ra Runs.

type aliasLine struct {
	Alias string `json:"alias"`
	To    string `json:"to"`
}

type keyLine struct {
	Key  string          `json:"key"`
	Sigs []signatureJSON `json:"sigs"`
}

type moduleLine struct {
	Module string `json:"module"`
}

type valueLine struct {
	Value  string `json:"value"`
	Module string `json:"module"`
}

type signatureJSON struct {
	N         string            `json:"n"`
	P         []json.RawMessage `json:"p,omitempty"`
	DataFirst int               `json:"df,omitempty"`
	DataLast  int               `json:"dl,omitempty"`
	Self      int               `json:"sf,omitempty"`
	Result    string            `json:"r,omitempty"`
	Runs      string            `json:"ra,omitempty"`
}

type paramJSON struct {
	T string            `json:"t,omitempty"`
	E string            `json:"e,omitempty"`
	P map[string]string `json:"p,omitempty"`
	A string            `json:"a,omitempty"`
}

// WriteTable writes header, aliases, values, and entries in the file
// format, sorted, so the same inputs always give the same bytes.
func WriteTable(w io.Writer, header Header, modules []string, entries map[string][]Signature, aliases map[string]string, values map[string]string) error {
	header.Keys, header.Aliases, header.Modules = len(entries), len(aliases), len(modules)
	bw := bufio.NewWriter(w)
	line := func(v any) error {
		data, err := marshalLine(v)
		if err != nil {
			return err
		}
		bw.Write(data)
		return bw.WriteByte('\n')
	}
	if err := line(header); err != nil {
		return err
	}
	sorted := slices.Clone(modules)
	slices.Sort(sorted)
	for _, m := range sorted {
		if err := line(moduleLine{Module: m}); err != nil {
			return err
		}
	}
	names := make([]string, 0, len(aliases))
	for name := range aliases {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		if err := line(aliasLine{Alias: name, To: aliases[name]}); err != nil {
			return err
		}
	}
	valueKeys := make([]string, 0, len(values))
	for v := range values {
		valueKeys = append(valueKeys, v)
	}
	slices.Sort(valueKeys)
	for _, v := range valueKeys {
		if err := line(valueLine{Value: v, Module: values[v]}); err != nil {
			return err
		}
	}
	keys := make([]string, 0, len(entries))
	for k := range entries {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		kl := keyLine{Key: k}
		for _, s := range entries[k] {
			kl.Sigs = append(kl.Sigs, encodeSignature(s))
		}
		if err := line(kl); err != nil {
			return err
		}
	}
	return bw.Flush()
}

// marshalLine is json.Marshal without HTML escaping, so <, >, and & stay
// readable in keys.
func marshalLine(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func encodeSignature(s Signature) signatureJSON {
	n := strconv.Itoa(s.Min)
	if s.Max != s.Min {
		n += "-" + strconv.Itoa(s.Max)
	}
	if s.Rest {
		n += "+"
	}
	out := signatureJSON{N: n}
	params := s.Params
	for len(params) > 0 && params[len(params)-1].IsZero() {
		params = params[:len(params)-1]
	}
	for _, p := range params {
		var raw []byte
		if p.Elem == 0 && len(p.Props) == 0 && p.AnyProp == 0 {
			raw, _ = json.Marshal(p.Top.String())
		} else {
			pj := paramJSON{T: p.Top.String(), E: p.Elem.String(), A: p.AnyProp.String()}
			if len(p.Props) > 0 {
				pj.P = map[string]string{}
				for k, v := range p.Props {
					pj.P[k] = v.String()
				}
			}
			raw, _ = marshalLine(pj) // encoding/json sorts map keys
		}
		out.P = append(out.P, raw)
	}
	if s.DataFirst {
		out.DataFirst = 1
	}
	if s.DataLast {
		out.DataLast = 1
	}
	if s.Self {
		out.Self = 1
	}
	out.Result, out.Runs = s.Result, s.Runs
	return out
}

// ReadTable parses a table in the file format that WriteTable writes.
func ReadTable(r io.Reader) (*Table, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	return readTable(data)
}

func decodeSignature(sj signatureJSON) (Signature, error) {
	var s Signature
	n := sj.N
	if strings.HasSuffix(n, "+") {
		s.Rest = true
		n = n[:len(n)-1]
	}
	lo, hi, found := strings.Cut(n, "-")
	var err error
	if s.Min, err = strconv.Atoi(lo); err != nil {
		return s, fmt.Errorf("bad arity %q", sj.N)
	}
	s.Max = s.Min
	if found {
		if s.Max, err = strconv.Atoi(hi); err != nil {
			return s, fmt.Errorf("bad arity %q", sj.N)
		}
	}
	for _, raw := range sj.P {
		var p Param
		var str string
		if json.Unmarshal(raw, &str) == nil {
			if p.Top, err = ParseClass(str); err != nil {
				return s, err
			}
		} else {
			var pj paramJSON
			if err := json.Unmarshal(raw, &pj); err != nil {
				return s, err
			}
			if p.Top, err = ParseClass(pj.T); err != nil {
				return s, err
			}
			if p.Elem, err = ParseClass(pj.E); err != nil {
				return s, err
			}
			if p.AnyProp, err = ParseClass(pj.A); err != nil {
				return s, err
			}
			for k, v := range pj.P {
				c, err := ParseClass(v)
				if err != nil {
					return s, err
				}
				if p.Props == nil {
					p.Props = map[string]Class{}
				}
				p.Props[k] = c
			}
		}
		s.Params = append(s.Params, p)
	}
	s.DataFirst = sj.DataFirst != 0
	s.DataLast = sj.DataLast != 0
	s.Self = sj.Self != 0
	s.Result, s.Runs = sj.Result, sj.Runs
	return s, nil
}
