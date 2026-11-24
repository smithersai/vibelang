class Gone extends TaggedError("Gone")<{
    readonly id: string;
}> {
    static {
        $schemaErrorMatcher(this, "Gone", true);
    }
}
class Busy extends TaggedError("Busy")<{}> {
    static {
        $schemaErrorMatcher(this, "Busy", true);
    }
}
function recover(job: Effect.Effect<string, (Gone | Busy), never>) {
    const fallback = $catchExpression(() => job, () => "guest");
    const tag = $catchExpression(() => job, (e) => e._tag);
    return $catchExpression(() => job, (e) => (() => {
        const $match1 = e;
        {
            if ($is(Gone, $match1)) {
                return e.id;
            }
        }
        return (() => { throw e; })();
    })());
}
