export fn add(left: i32, right: i32) i32 {
    return left + right;
}

export fn fibonacci(n: i32) i32 {
    if (n < 2) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}
