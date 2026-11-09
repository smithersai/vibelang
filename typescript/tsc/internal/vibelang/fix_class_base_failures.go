package vibelang

// Before class bases were effect code, a plain call in one threw a defect
// from the generator. Keep that behavior when --fix repairs a newly exposed
// failure outside the enclosing function's written E. Explicitly run Effects
// keep their typed failures; this repair only wraps plain calls.
