export function count(xs) {
    let total = 0;
    for (let i = 0; i < xs.length; i++) {
        if (xs[i])
            total++;
    }
    return total;
}
