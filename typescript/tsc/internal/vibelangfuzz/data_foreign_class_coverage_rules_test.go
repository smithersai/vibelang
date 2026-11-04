package vibelangfuzz

// VIP-7: ordinary constructors do not prove whole-case coverage.
func dataForeignClassCoverageRules() []dataRule {
	return []dataRule{
		{"foreign-class-coverage-tagged-error", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f(s:Wanted){return match(s){when Wanted:1;}}", "only:EK4701", "impl-hunt-data"},
		{"foreign-class-coverage-alias", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}const Alias=Wanted;function f(s:Wanted){return match(s){when Alias:1;}}", "only:EK4701", "impl-hunt-data"},
		{"foreign-class-coverage-property", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}const Types={Wanted};function f(s:Wanted){return match(s){when Types.Wanted:1;}}", "only:EK4701", "impl-hunt-data"},
		{"foreign-class-coverage-subclass", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}class Child extends Wanted{}function f(s:Child){return match(s){when Child:1;}}", "only:EK4701", "impl-hunt-data"},
		{"foreign-class-coverage-or", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}class Another extends Data.TaggedError(\"Other\")<{}>{}function f(s:Wanted|Another){return match(s){when Wanted or Another:1;}}", "only:EK4701", "impl-hunt-data"},
		{"foreign-class-coverage-nested", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f(s:{_tag:\"A\",value:Wanted}|{_tag:\"B\"}){return match(s){when {_tag:\"A\",value:Wanted}:1;when {_tag:\"B\"}:2;}}", "only:EK4701", "impl-hunt-data"},
		{"foreign-class-coverage-generic", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f<T extends Wanted>(s:T){return match(s){when Wanted:1;}}", "only:EK4701", "impl-hunt-data"},
		{"foreign-class-coverage-data-error", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.Error<{}>{readonly _tag=\"Shared\" as const}function f(s:Wanted){return match(s){when Wanted:1;}}", "only:EK4701", "impl-hunt-data"},
		{"foreign-class-coverage-native-tagged", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Error{readonly _tag=\"Shared\" as const}function f(s:Wanted){return match(s){when Wanted:1;}}", "only:EK4701", "impl-hunt-data"},
		{"foreign-class-coverage-default", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f(s:Wanted){return match(s){when Wanted:1;default:0;}}", "", "impl-hunt-data"},
		{"foreign-class-coverage-tag-object", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f(s:Wanted){return match(s){when {_tag:\"Shared\"}:1;}}", "", "impl-hunt-data"},
		{"foreign-class-coverage-binding", "004-match.md", "user-matcher patterns cover nothing", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f(s:Wanted){return match(s){when Wanted:1;when let rest:0;}}", "", "impl-hunt-data"},
		{"foreign-class-coverage-open", "004-match.md", "user-matcher patterns cover nothing", "class Plain{}function f(s:Plain){return match(s){when Plain:1;}}", "", "impl-hunt-data"},
		{"foreign-class-coverage-generated-error", "004-match.md", "user-matcher patterns cover nothing", "error Wanted {} function f(s:Wanted){return match(s){when Wanted:1;}}", "", "impl-hunt-data"},
		{"foreign-class-coverage-generated-schema-error", "004-match.md", "user-matcher patterns cover nothing", "schema error Wanted {} function f(s:Wanted){return match(s){when Wanted:1;}}", "", "impl-hunt-data"},
		{"foreign-class-coverage-fixed", "004-match.md", "user-matcher patterns cover nothing", "function f(s:Option.Option<number>){return match(s){when Option.Some(let n):n;when Option.None:0;}}", "", "impl-hunt-data"},
		{"foreign-class-coverage-retained-error", "004-match.md", "user-matcher patterns cover nothing", "function f(s:Cause.TimeoutError){return match(s){when Cause.TimeoutError:1;}}", "", "impl-hunt-data"},
	}
}
