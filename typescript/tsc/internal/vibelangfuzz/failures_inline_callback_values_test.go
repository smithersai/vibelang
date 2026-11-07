package vibelangfuzz

func failuresInlineCallbackCases() []*failCase {
	const quote = "may contain calls known to throw: they belong to the enclosing call"
	const lib = `/** @throws {never}
 * @rethrows cb
 */
export declare function invoke(cb:()=>number):number
export declare class Runner {
/** @throws {never}
 * @rethrows cb
 */
constructor(cb:()=>number)
}
/** @throws {never}
 * @rethrows cb
 */
export declare function tag(parts:TemplateStringsArray,cb:()=>number):number
`
	var cases []*failCase
	for _, shape := range []struct{ key, text string }{
		{"first", "s.length>0?(()=>JSON.parse(s)):(()=>0)"},
		{"last", "s.length>0?(()=>0):(()=>JSON.parse(s))"},
		{"nullish", "(s.length>0?(()=>0):undefined)??(()=>JSON.parse(s))"},
		{"or", "(s.length>0?(()=>0):undefined)||(()=>JSON.parse(s))"},
		{"and-or", "(s.length>0&&(()=>JSON.parse(s)))||(()=>0)"},
		{"comma", "(Math.max(1),()=>JSON.parse(s))"},
		{"nested", "s.length>0?((s.length>1?(()=>0):undefined)||(()=>JSON.parse(s))):(()=>0)"},
		{"function", "s.length>0?function(){return JSON.parse(s)}:(()=>0)"},
	} {
		for _, kind := range []string{"call", "new", "tag"} {
			call := "invoke(" + shape.text + ")"
			if kind == "new" {
				call = "new Runner(" + shape.text + ")"
			}
			if kind == "tag" {
				call = "tag" + string(rune(96)) + "x$" + "{" + shape.text + "}" + string(rune(96))
			}
			for _, context := range []string{"plain", "effect", "caught", "wrapped"} {
				host, body, code := "effect", call, 403
				switch context {
				case "plain":
					host, code = "plain", 401
				case "caught":
					host, body, code = "plain", "try{"+call+"}catch{}", 0
				case "wrapped":
					body, code = "try Effect.try(()=>"+call+")", 0
				}
				if code != 0 {
					body = "⟦" + body + "⟧"
				}
				cases = append(cases, &failCase{Name: "rethrows-inline-value-" + shape.key + "-" + kind + "-" + context, VIP: 4, Quote: quote, Host: host, Body: body, Lib: lib, Code: code, OneDiagnostic: code != 0})
			}
		}
	}
	for _, row := range []struct {
		key, body, quote string
		code             int
	}{
		{"safe", "invoke(s.length>0?(()=>1):(()=>0))", quote, 0},
		{"nested-scope", "invoke(s.length>0?(()=>{const nested=()=>⟦JSON.parse(s)⟧;return 0}):(()=>0))", "A function nested in that literal is its own plain code.", 401},
		{"explicit-throw", "invoke(s.length>0?(()=>{⟦throw 1⟧}):(()=>0))", "A `throw` statement or throw expression in the literal is still `EK0401`.", 401},
	} {
		cases = append(cases, &failCase{Name: "rethrows-inline-value-" + row.key, VIP: 4, Quote: row.quote, Host: "plain", Body: row.body, Lib: lib, Code: row.code, OneDiagnostic: row.code != 0})
	}
	return cases
}
