function f(items: number[]) { const task = fork(read()); const value = $join(task); const all = $join([task]); {
    const $concurrentLimit1 = 2;
    $concurrentHead1: {
        $forConcurrent(items, $concurrentLimit1, $concurrentItem => {
            const item = $concurrentItem;
            write(item);
        });
        break $concurrentHead1;
        let item!;
    }
} return { value, all }; }
