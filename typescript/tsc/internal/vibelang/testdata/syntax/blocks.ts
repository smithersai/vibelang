const increment = (x: number) => x + 1;
export function main() {
    let $do1;
    {
        const x = 2;
        $do1 = x + 1;
    }
    const value = $do1;
    return withSpan(() => { return increment(value); }, "increment");
}
await runPromise(main());
