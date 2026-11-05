package vibelangfuzz

const satisfiesCallbackQuote = "A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, `@throws {unknown}` admits anything, and a parameter named by `@rethrows` admits anything."

func failuresSatisfiesCases() []*failCase {
	var cases []*failCase
	const lib = `/** @throws {RangeError} */
export declare function risky(n:number):number
/** @throws {never} */
export declare function safe(n:number):number
/** @throws {unknown} */
export declare function mystery(n:number):number
/** @throws {RangeError} */
export declare function generic<T>(n:T):T
export declare const holder:{read:typeof risky}
export interface Pure {
/** @throws {never} */
(n:number):number
}
export interface Admitting {
/** @throws {RangeError} */
(n:number):number
}
export interface UnknownBound {
/** @throws {unknown} */
(n:number):number
}
/** @throws {never} */
export declare function accepts(cb:Pure):number
/** @throws {never}
 * @rethrows cb
 */
export declare function invoke(cb:(n:number)=>number):number
`
	for _, source := range []struct{ key, expr, throws string }{
		{"range", "risky", "range"}, {"never", "safe", "never"}, {"unknown", "mystery", "unknown"},
		{"generic", "generic", "range"}, {"property", "holder.read", "range"}, {"element", "holder['read']", "range"},
	} {
		add := func(name, body string, code int) {
			cases = append(cases, &failCase{Name: "callback-satisfies-" + source.key + "-" + name, Quote: satisfiesCallbackQuote, VIP: 4, Host: "plain", Lib: lib, Body: body, Code: code, OneDiagnostic: code != 0})
		}
		for _, bound := range []struct{ key, typ string }{
			{"pure", "Pure"}, {"range", "Admitting"}, {"unknown", "UnknownBound"},
		} {
			rejected := source.throws != "never" && (bound.key == "pure" || source.throws == "unknown" && bound.key != "unknown")
			for _, layout := range []string{"direct", "parenthesized"} {
				expr := source.expr
				code := 0
				if rejected {
					expr = "⟦" + expr + "⟧"
					code = 402
				}
				if layout == "parenthesized" {
					expr = "(" + expr + ")"
				}
				add(bound.key+"-"+layout, "const checked="+expr+" satisfies "+bound.typ+";", code)
			}
			expr := source.expr
			code := 0
			if rejected {
				expr = "⟦" + expr + "⟧"
				code = 402
			}
			add(bound.key+"-caught", "try{invoke("+expr+" satisfies "+bound.typ+")}catch{}", code)
		}

		for _, bound := range []struct{ key, typ string }{
			{"pure", "Pure"}, {"range", "Admitting"}, {"unknown", "UnknownBound"},
		} {
			expr := source.expr + " satisfies UnknownBound"
			code := 0
			rejected := source.throws != "never" && (bound.key == "pure" || source.throws == "unknown" && bound.key != "unknown")
			if rejected {
				expr = "⟦" + expr + "⟧"
				code = 402
			}
			add("chained-"+bound.key, "const checked="+expr+" satisfies "+bound.typ+";", code)
		}
		for _, order := range []string{"first", "last"} {
			expr := source.expr
			code := 0
			if source.throws != "never" {
				expr = "⟦" + expr + "⟧"
				code = 402
			}
			branches := expr + ":safe"
			if order == "last" {
				branches = "safe:" + expr
			}
			add("conditional-"+order, "const checked=((true as boolean)?"+branches+") satisfies Pure;", code)
		}
		for _, context := range []string{"argument", "initializer", "return"} {
			expr := source.expr + " satisfies UnknownBound"
			code := 0
			if source.throws != "never" {
				expr = "⟦" + expr + "⟧"
				code = 402
			}
			body := "accepts(" + expr + ");"
			if context == "initializer" {
				body = "const checked:Pure=" + expr + ";"
			}
			if context == "return" {
				body = "function read():Pure{return " + expr + "} read();"
			}
			add("outer-"+context, body, code)
		}
	}
	return cases
}
