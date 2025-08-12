export function isNullish(x: unknown): x is null | undefined {
	return x === null || x === undefined;
}

export function isNotNullish<T>(x: T | null | undefined): x is NonNullable<T> {
	return !isNullish(x);
}
