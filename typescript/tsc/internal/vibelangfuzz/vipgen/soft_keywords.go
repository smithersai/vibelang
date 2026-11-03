package vipgen

import (
	"fmt"
	"slices"
	"strings"
)

// SoftKeywordWords includes Appendix A's contextual/reserved words, the
// inherited TypeScript words used by its productions, and contextual suffixes.
// The latter are identifiers outside their owning production, not global bans.
var SoftKeywordWords = strings.Fields("effect service error schema data fork join concurrent uninterruptible interruptible restore provide match when is and or not try catch do async await yield using for throw function default get set static readonly of in all race any allSettled scoped detached as satisfies let const break case class continue debugger delete else enum export extends false finally if import instanceof new null return super switch this true typeof var void while with implements interface package private protected public abstract accessor asserts assert boolean constructor declare immediate infer intrinsic keyof module namespace never out require number object string symbol type undefined unique unknown from global bigint override defer source")
var SoftKeywordForms = strings.Fields("const let parameter destructured function class import label catch property")
var SoftKeywordHomes = strings.Fields("effect plain async field enum static static-effect module")
var SoftKeywordUses = strings.Fields("called read passed")

type SoftKeywordShape struct{ Word, Form, Home, Use string }

func (s SoftKeywordShape) Key() string {
	return strings.Join([]string{s.Word, s.Form, s.Home, s.Use}, ":")
}
func SoftKeywordShapeFor(key string) SoftKeywordShape {
	parts := strings.Split(key, ":")
	if len(parts) == 4 && slices.Contains(SoftKeywordWords, parts[0]) && slices.Contains(SoftKeywordForms, parts[1]) && slices.Contains(SoftKeywordHomes, parts[2]) && slices.Contains(SoftKeywordUses, parts[3]) {
		return SoftKeywordShape{parts[0], parts[1], parts[2], parts[3]}
	}
	var n uint64
	for _, b := range []byte(key) {
		n = n*33 + uint64(b)
	}
	pick := func(xs []string) string { x := xs[n%uint64(len(xs))]; n /= uint64(len(xs)); return x }
	return SoftKeywordShape{pick(SoftKeywordWords), pick(SoftKeywordForms), pick(SoftKeywordHomes), pick(SoftKeywordUses)}
}
func SoftKeywordShapes() []SoftKeywordShape {
	var out []SoftKeywordShape
	for _, w := range SoftKeywordWords {
		for _, f := range SoftKeywordForms {
			for _, h := range SoftKeywordHomes {
				for _, u := range SoftKeywordUses {
					out = append(out, SoftKeywordShape{w, f, h, u})
				}
			}
		}
	}
	return out
}

// ReservedBinding is deliberately narrower than "a binding is in scope".
// Imports bind at module scope. Property names are IdentifierNames. Field/enum
// initializers reset Effect; static blocks inherit it. Native function names
// inside Effect are bindings there, although their parameters/bodies reset it.
func (s SoftKeywordShape) ReservedBinding() bool {
	return (s.Word == "fork" || s.Word == "join") && (s.Home == "effect" || s.Home == "static-effect" || (s.Form == "label" && s.EffectResult())) && s.Form != "property" && s.Form != "import"
}
func (s SoftKeywordShape) EffectResult() bool {
	return slices.Contains([]string{"effect", "field", "enum", "static-effect"}, s.Home)
}

// Sources prints a .vibe and an ordinary .ts twin. Binding forms that cannot
// occur in an initializer are in its enclosing module scope. Parameters and
// catch bindings for non-callable homes live in a plain source-scope function;
// the use still occurs directly in the requested initializer/static block.
func (s SoftKeywordShape) Sources() (string, string) {
	build := func(vibe bool) string {
		name := s.Word
		fn := "(n: number = 0): number => n + 7"
		decl := "const " + name + " = " + fn + ";"
		arg := ""
		switch s.Form {
		case "let":
			decl = "let " + name + " = " + fn + ";"
		case "parameter":
			decl = ""
			arg = name + " = " + fn
		case "destructured":
			decl = "const { value: " + name + " } = { value: " + fn + " };"
		case "function":
			decl = "function " + name + "(n: number = 0): number { return n + 7 }"
		case "class":
			decl = "class " + name + " { value = 7 }"
		case "import":
			decl = ""
		case "property":
			decl = "const box = { " + name + ": " + fn + " };"
			name = "box." + name
		}
		use := name + "(3)"
		if s.Form == "class" {
			use = "new " + name + "().value"
		}
		if s.Use == "read" {
			use = "(typeof " + name + " === \"function\" ? 1 : 0)"
		}
		if s.Use == "passed" {
			use = "((value: unknown): number => typeof value === \"function\" ? 2 : 0)(" + name + ")"
		}
		stmt := decl + " return " + use + ";"
		if s.Form == "label" {
			stmt = decl + " " + s.Word + ": { return " + use + "; }"
		}
		if s.Form == "catch" {
			stmt = "try { throw (" + fn + ") } catch (" + s.Word + ") { return " + strings.ReplaceAll(use, name, "("+name+" as (n: number) => number)") + "; }"
		}
		modifier := ""
		if vibe && s.EffectResult() {
			modifier = "effect "
		}
		switch s.Home {
		case "plain", "async", "effect":
			if s.Home == "async" {
				modifier = "async "
			}
			return softKeywordImport(s) + "export " + modifier + "function probe(" + arg + ") { " + stmt + " }\n"
		case "module":
			if s.Form == "parameter" || s.Form == "catch" {
				return softKeywordImport(s) + "function scope(" + arg + ") { " + stmt + " }\nconst result = scope(); export function probe() { return result }\n"
			}
			if s.Form == "label" {
				return softKeywordImport(s) + decl + " let result = 0; " + s.Word + ": { result = " + use + "; break " + s.Word + "; } export function probe() { return result }\n"
			}
			return softKeywordImport(s) + decl + " const result = " + use + "; export function probe() { return result }\n"
		}
		// A static-effect local declaration stays inside the reserved static block.
		if s.Home == "static-effect" && s.Form != "parameter" && s.Form != "catch" {
			inside := decl + " Holder.value = " + use + ";"
			if s.Form == "label" {
				inside = decl + " " + s.Word + ": { Holder.value = " + use + "; break " + s.Word + "; }"
			}
			return softKeywordImport(s) + "export " + modifier + "function probe() { class Holder { static value = 0; static { " + inside + " } } return Holder.value }\n"
		}
		inner := ""
		switch s.Home {
		case "field":
			inner = "class Holder { value = " + use + " } return new Holder().value;"
		case "enum":
			inner = "enum Holder { value = " + use + " } return Holder.value as number;"
		default:
			inner = "class Holder { static value = 0; static { Holder.value = " + use + "; } } return Holder.value as number;"
		}
		if s.Form == "label" {
			inner = s.Word + ": { " + inner + " }"
		}
		if s.Form == "parameter" || s.Form == "catch" {
			// For static-effect the reservation must include the actual parameter or
			// catch binding, so put it on the enclosing Effect callable.
			if s.Home == "static-effect" {
				if s.Form == "catch" {
					inner = "try { throw (" + fn + ") } catch (" + s.Word + ") { " + strings.ReplaceAll(inner, use, strings.ReplaceAll(use, name, "("+name+" as (n: number) => number)")) + " }"
				}
				return softKeywordImport(s) + "export " + modifier + "function probe(" + arg + ") { " + inner + " }\n"
			}
			if s.Form == "catch" {
				inner = strings.ReplaceAll(inner, use, strings.ReplaceAll(use, name, "("+name+" as (n: number) => number)"))
				return softKeywordImport(s) + "function scope() { try { throw (" + fn + ") } catch (" + s.Word + ") { " + modifier + "function inner() { " + inner + " } return inner(); } } export function probe() { return scope() }\n"
			}
			return softKeywordImport(s) + "function scope(" + arg + ") { " + modifier + "function inner() { " + inner + " } return inner(); } export function probe() { return scope() }\n"
		}
		return softKeywordImport(s) + decl + " export " + modifier + "function probe() { " + inner + " }\n"
	}
	return build(true), build(false)
}
func softKeywordImport(s SoftKeywordShape) string {
	if s.Form == "import" {
		return fmt.Sprintf("import { helper as %s } from \"./soft-keyword-helper.js\";\n", s.Word)
	}
	return ""
}

const SoftKeywordHelper = "/** @throws {never} */\nexport function helper(n: number = 0): number { return n + 7 }\n"
