function* ticks() { yield 1; sleep("1 second"); yield 2; }
function consume() {
    $doHead2: {
        const $forTryHead1 = ticks();
        for (const x of $forTryHead1) {
            if (x === 2)
                break;
        }
        break $doHead2;
        let x!;
    }
    {
        const $concurrentLimit1 = 2;
        $concurrentHead1: {
            $forConcurrent([1, 2], $concurrentLimit1, $concurrentItem => {
                const x = $concurrentItem;
                {
                    log(x);
                }
            });
            break $concurrentHead1;
            let x!;
        }
    }
}
