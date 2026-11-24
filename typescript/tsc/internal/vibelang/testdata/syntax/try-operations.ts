function run(left: Effect.Effect<number, never, never>, right: Effect.Effect<number, string, never>) {
    const both = $tryAll([left, right]);
    const settled = $tryAllSettled([left, right]);
    const first = $tryRace([left, right]);
    const success = $tryAny([left, right]);
    return { both, settled, first, success };
}
