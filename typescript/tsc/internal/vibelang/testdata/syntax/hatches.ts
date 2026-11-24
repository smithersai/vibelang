function parse(raw: string) {
    const n = Effect.try({ try: () => JSON.parse(raw), catch: (e) => String(e) });
    const doubled = sync(() => n * 2);
    const value = promise(() => Promise.resolve(doubled));
    return tryPromise({ try: () => Promise.resolve(value), catch: (e) => String(e) });
}
