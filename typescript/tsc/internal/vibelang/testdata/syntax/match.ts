function f(value: unknown) { {
    const $match2 = value;
    {
        if ($match2 === 1) {
            return "one";
        }
    }
    {
        if ($is(String, $match2)) {
            let text = $match2;
            return text;
        }
    }
    return "other";
} }
function result(job: Effect.Effect<number, string, never>) {
    {
        const $match6 = exit(job);
        {
            const $extracted7 = $extract(Exit.Success, $match6);
            if ($extracted7 !== false && $extracted7.length === 1) {
                let n = $extracted7[0];
                return n;
            }
        }
        {
            const $extracted8 = $extract(Exit.Failure, $match6);
            if ($extracted8 !== false && $extracted8.length === 1) {
                let cause = $extracted8[0];
                return 0;
            }
        }
        return $noMatch($match6);
    }
}
