package vibelangfuzz

func failuresTupleInlineCases() []*failCase {
	const quote = "may contain calls known to throw: they belong to the enclosing call"
	const lib = `/** @throws {never}
 * @rethrows cb
 */
export declare function higher(cb:()=>number):number
/** @throws {never}
 * @rethrows cb
 */
export declare function after(prefix:number,cb:()=>number):number
/** @throws {never}
 * @rethrows callbacks
 */
export declare function many(...callbacks:(()=>number)[]):number
/** @throws {never}
 * @rethrows cb
 */
export declare function optional(cb?:()=>number):number
/** @throws {never}
 * @rethrows cb
 */
export declare function consume<T>(cb:()=>T):void
export declare class Runner{
/** @throws {never}
 * @rethrows cb
 */
constructor(cb:()=>number)
}
`
	var cases []*failCase
	for _, shape := range []string{"direct", "parentheses", "nested", "prefix", "split", "rest", "new", "optional", "stored-prefix", "nested-prefix"} {
		for _, literal := range []struct{ key, text string }{{"arrow", "()=>JSON.parse(s)"}, {"function", "function(){return JSON.parse(s)}"}} {
			value := literal.text
			prefix, call := "", "higher(...["+value+"] as const)"
			switch shape {
			case "parentheses":
				call = "higher(...([" + value + "] as const))"
			case "nested":
				call = "higher(...[...[" + value + "] as const] as const)"
			case "prefix":
				call = "after(...[1," + value + "] as const)"
			case "split":
				call = "after(...[1] as const,...[" + value + "] as const)"
			case "rest":
				call = "many(...[()=>0," + value + "] as const)"
			case "new":
				call = "new Runner(...[" + value + "] as const)"
			case "optional":
				call = "optional(...[" + value + "] as [(()=>number)?])"
			case "stored-prefix":
				prefix, call = "const prefix=[1] as const;", "after(...prefix,...["+value+"] as const)"
			case "nested-prefix":
				prefix, call = "const prefix=[1] as const;", "after(...[...prefix,"+value+"] as const)"
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
				cases = append(cases, &failCase{Name: "rethrows-tuple-inline-" + shape + "-" + literal.key + "-" + context, VIP: 4, Quote: quote, Host: host, Body: prefix + body, Lib: lib, Code: code, OneDiagnostic: code != 0})
			}
		}
	}
	for _, row := range []struct {
		key, body, quote string
		code             int
	}{
		{"safe", "higher(...[()=>0] as const)", quote, 0},
		{"stored", "const callbacks=[()=>⟦JSON.parse(s)⟧] as const;consume(...callbacks)", quote, 401},
		{"nested-scope", "consume(...[()=>{const inner=()=>⟦JSON.parse(s)⟧;return 0}] as const)", "A function nested in that literal is its own plain code.", 401},
		{"explicit-throw", "consume(...[()=>{⟦throw 1⟧}] as const)", "A `throw` statement or throw expression in the literal is still `EK0401`.", 401},
		{"effectful", "consume(...[()=>Effect.succeed(⟦JSON.parse(s)⟧)] as const)", "A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401`", 401},
		{"generator-body", "consume(...[function*(){yield ⟦JSON.parse(s)⟧}] as const)", generatorPlainCallsQuote, 401},
		{"async-body", "consume(...[async()=>JSON.parse(s)] as const)", quote, 0},
		{"async-default", "consume(...[async(value=JSON.parse(s))=>value] as const)", quote, 0},
	} {
		cases = append(cases, &failCase{Name: "rethrows-tuple-inline-" + row.key, VIP: 4, Quote: row.quote, Host: "plain", Body: row.body, Lib: lib, Code: row.code, OneDiagnostic: row.code != 0})
	}
	return cases
}
