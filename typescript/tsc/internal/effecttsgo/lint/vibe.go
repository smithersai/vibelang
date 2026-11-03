package lint

import (
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rules"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/ast"
)

// vibeAnswer is how VibeLang answers one of Effect's rules in a .vibe file
// (D240; the table on the user guide's Devtools page). A rule with no answer
// runs as Effect wrote it, and `vibelang lint` runs every rule without an ek
// (lintRuleNames).
type vibeAnswer struct {
	// ek is the VibeLang diagnostic that ports the rule through VibeLang's view
	// of the code: `vibelang lint` reports it at the rule's configured severity.
	ek string
	// covered is the diagnostic every build already reports for it.
	covered string
	// notNeeded says why VibeLang's syntax or semantics rule the pattern out.
	notNeeded string
}

var vibeAnswers = map[string]vibeAnswer{
	"anyUnknownInErrorContext":      {ek: "EK4811"},
	"duplicatePackage":              {ek: "EK4803"},
	"floatingEffect":                {ek: "EK4801"},
	"outdatedApi":                   {ek: "EK4813"},
	"overriddenSchemaConstructor":   {ek: "EK4814"},
	"effectInFailure":               {ek: "EK4815"},
	"effectInVoidSuccess":           {ek: "EK4802"},
	"returnEffectInGen":             {ek: "EK4802"},
	"globalErrorInEffectCatch":      {ek: "EK4804"},
	"globalErrorInEffectFailure":    {ek: "EK4804"},
	"layerMergeAllWithDependencies": {ek: "EK4807"},
	"leakingRequirements":           {ek: "EK4809"},
	"multipleEffectProvide":         {ek: "EK4808"},
	"strictEffectProvide":           {ek: "EK4816"},
	"unknownInEffectCatch":          {ek: "EK4806"},
	"extendsNativeError":            {ek: "EK4805"},
	"instanceOfSchema":              {ek: "EK4817"},
	"newPromise":                    {ek: "EK4812"},
	"preferSchemaOverJson":          {ek: "EK4818"},
	"unsafeEffectTypeAssertion":     {ek: "EK4810"},
	"schemaStructWithTag":           {ek: "EK4821"},
	"strictBooleanExpressions":      {ek: "EK4822"},
	"unnecessaryArrowBlock":         {ek: "EK4823"},
	"unnecessaryPipe":               {ek: "EK4824"},
	"unnecessaryPipeChain":          {ek: "EK4825"},

	"genericEffectServices":    {covered: "EK3005"},
	"missingEffectContext":     {covered: "EK9202"},
	"missingEffectError":       {covered: "EK9201"},
	"missingLayerContext":      {covered: "EK3201"},
	"catchUnfailableEffect":    {covered: "EK9204"},
	"runEffectInsideEffect":    {covered: "EK1005"},
	"asyncFunction":            {covered: "EK1003"},
	"cryptoRandomUUID":         {covered: "EK4403"},
	"cryptoRandomUUIDInEffect": {covered: "EK4403"},
	"globalConsole":            {covered: "EK4402"},
	"globalConsoleInEffect":    {covered: "EK4402"},
	"globalDate":               {covered: "EK4403"},
	"globalDateInEffect":       {covered: "EK4403"},
	"globalFetch":              {covered: "EK4402"},
	"globalFetchInEffect":      {covered: "EK4402"},
	"globalRandom":             {covered: "EK4403"},
	"globalRandomInEffect":     {covered: "EK4403"},
	"globalTimers":             {covered: "EK4402"},
	"globalTimersInEffect":     {covered: "EK4402"},
	"nodeBuiltinImport":        {covered: "EK4402"},
	"processEnv":               {covered: "EK4402"},
	"processEnvInEffect":       {covered: "EK4402"},

	"classSelfMismatch":             {notNeeded: "a service has no Self parameter"},
	"effectFnImplicitAny":           {notNeeded: "parameters are TypeScript's, so strict reports TS7006"},
	"missingReturnYieldStar":        {notNeeded: "throw ends the function"},
	"missingStarInYieldEffectGen":   {notNeeded: "a call runs; Effect.gen with function* is EK1002"},
	"effectFnIife":                  {notNeeded: "no Effect.fn; an immediately called function is a call"},
	"effectGenUsesAdapter":          {notNeeded: "no Effect.gen"},
	"lazyPromiseInEffectSync":       {notNeeded: "sync(() => promise) compiles to Effect.promise"},
	"tryCatchInEffectGen":           {notNeeded: "catch catches failures"},
	"catchAllToMapError":            {notNeeded: "a catch that rethrows is the one form"},
	"deterministicKeys":             {notNeeded: "the compiler derives each service key"},
	"effectDoNotation":              {notNeeded: "const statements bind values"},
	"effectFnOpportunity":           {notNeeded: "every function is one"},
	"effectMapFlatten":              {notNeeded: "statements"},
	"effectMapVoid":                 {notNeeded: "statements"},
	"effectSucceedWithVoid":         {notNeeded: "a function that returns nothing"},
	"flatMapToMap":                  {notNeeded: "statements"},
	"importFromBarrel":              {notNeeded: "effect's root names and subpath modules are in scope"},
	"missedPipeableOpportunity":     {notNeeded: "a refactor, Convert to a pipe"},
	"nestedEffectGenYield":          {notNeeded: "no Effect.gen"},
	"redundantSchemaTagIdentifier":  {notNeeded: "declarations take their tag from their name"},
	"serviceNotAsClass":             {notNeeded: "service declarations"},
	"unnecessaryEffectGen":          {notNeeded: "no Effect.gen"},
	"unnecessaryFailYieldableError": {notNeeded: "throw new E() is the one form"},
	"unsupportedServiceAccessors":   {notNeeded: "Users.find(id) calls a member through the key"},
}

// vibeRuleNames are the rules that run as Effect wrote them on .vibe files: those VibeLang does not answer.
var vibeRuleNames = func() []string {
	var names []string
	for _, r := range rules.All {
		if _, answered := vibeAnswers[r.Name]; !answered {
			names = append(names, r.Name)
		}
	}
	return names
}()

// ruleNamesFor returns the rules a build runs on sf; nil selects every rule.
func ruleNamesFor(sf *ast.SourceFile) []string {
	if sf.FileName().IsVibeLangSource() {
		return vibeRuleNames
	}
	return nil
}

// lintMisreads are the rules `vibelang lint` leaves out of a .vibe file because
// they misread its forms. On alchemy's 8,400 .vibe files, whose .ts twins pass
// the same rules, these four were the only ones of the 105 to report: 207
// errors, on code they read through `|>` and effect arrows. The compiler's own
// check reports the same faults where it says so.
var lintMisreads = map[string]string{
	"catchUnfailableEffect":     "EK9204 reports it",
	"missedPipeableOpportunity": "it reads a |> pipeline as nested calls",
	"missingEffectContext":      "the compiler checks a contract's requirements",
	"missingEffectError":        "the compiler checks a contract's failures",
	"missingLayerContext":       "the compiler checks a layer's requirements",
}

// lintRuleNames are the rules `vibelang lint` runs on a .vibe file for an
// Oxlint configuration: every rule but those it reports through a VibeLang
// port, which would report the same fault twice, and those that misread the
// file. A repository's lint script covers .vibe as it covers .ts (VIP-38, detail
// 77), so a rule VibeLang answers with syntax still reports the file that spells
// the pattern through Effect's API, as a migrated file does.
var lintRuleNames = func() []string {
	var names []string
	for _, r := range rules.All {
		if _, misreads := lintMisreads[r.Name]; vibeAnswers[r.Name].ek == "" && !misreads {
			names = append(names, r.Name)
		}
	}
	return names
}()
