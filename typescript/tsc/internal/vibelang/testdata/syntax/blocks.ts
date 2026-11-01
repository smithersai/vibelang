function f() { let $do1; {
    const x = read();
    $do1 = x + 1;
} const value = $do1; return Effect.retry({ times: 2 }, () => { value; }); }
