package vibelangfuzz

// The retained guard is selected by resolved identity through each import form.
func dataJoseRetainedRules() []dataRule {
	const retained = "| `JoseError.JoseError` (`effect/jose/JoseError`) | `JoseError.isJoseError(s)` | `[s]` |"
	var rules []dataRule
	for _, binding := range []struct{ key, decl, matcher, typ string }{
		{"namespace", "import * as Errors from 'effect/jose/JoseError';", "Errors.JoseError", "Errors.JoseError"},
		{"named", "import {JoseError as ErrorClass} from 'effect/jose/JoseError';", "ErrorClass", "ErrorClass"},
		{"barrel", "import {JoseError as Errors} from 'effect/jose';", "Errors.JoseError", "Errors.JoseError"},
		{"constant", "import * as Errors from 'effect/jose/JoseError';const Alias=Errors.JoseError;", "Alias", "Errors.JoseError"},
	} {
		for _, shape := range []struct{ key, pattern, result, typ string }{
			{"bare", "", "value", binding.typ + "|null"},
			{"let", "(let found)", "found", binding.typ + "|null"},
			{"const", "(const found)", "found", binding.typ + "|null"},
			{"rest", "(...let found)", "found", "readonly " + binding.typ + "[]|null"},
			{"empty", "()", "true", "boolean|null"},
			{"extra", "(let first,let second)", "true", "boolean|null"},
		} {
			source := binding.decl + "function probe(value:unknown):" + shape.typ + "{return match(value){when " + binding.matcher + shape.pattern + ":" + shape.result + ";default:null;}}"
			rules = append(rules, dataRule{"jose-retained-" + binding.key + "-" + shape.key, "004-match.md", retained, source, ""})
		}
		rules = append(rules, dataRule{"jose-retained-" + binding.key + "-is", "004-match.md", retained, binding.decl + "function probe(value:unknown):boolean{return value is " + binding.matcher + "}", ""})
	}
	const ordinary = "An ordinary-class extractor without an own matcher is `EK0704`, with any argument count, including `()`"
	for _, suffix := range []string{"()", "(let found)"} {
		key := "empty"
		if suffix != "()" {
			key = "capture"
		}
		source := "class JoseError {} function probe(value:unknown){return match(value){when JoseError" + suffix + ":true;default:false;}}"
		rules = append(rules, dataRule{"jose-retained-shadow-" + key, "004-match.md", ordinary, source, "only:EK0704"})
	}
	return rules
}
