import { omitUndefined } from './omit-undefined';
import { sleep } from './sleep';

type LogFn = (obj: Record<string, unknown>, msg: string) => void;

export interface WithRetryLogger {
	debug: LogFn;
	error: LogFn;
}

export interface WithRetryOptions {
	maxAttempts?: number;
	shouldRetry?: (error: unknown) => boolean;
	/** A function that returns a number of milliseconds to delay. */
	retryDelay?: (numRetriesSoFar: number) => number;
}

interface WithRetryDebugOptions {
	debugName?: string;
}

type WithRetryInternalOptions = Required<WithRetryOptions> &
	WithRetryDebugOptions;

const defaultOptions: Required<WithRetryOptions> = {
	maxAttempts: 3,
	shouldRetry: () => true,
	retryDelay: () => 60 * 1000,
};

function mergeOptions(
	options: WithRetryOptions & WithRetryDebugOptions
): WithRetryInternalOptions {
	return {
		...defaultOptions,
		...omitUndefined(options),
	};
}

export function withRetry<T>(
	callback: () => Promise<T>,
	options: WithRetryOptions & WithRetryDebugOptions,
	logger?: WithRetryLogger
): Promise<T> {
	return withRetryImpl(callback, mergeOptions(options), logger);
}

function makeMessage(debugOptions: WithRetryDebugOptions) {
	function messageFn(message: string, { debugName }: WithRetryDebugOptions) {
		const tag = debugName ? `withRetry (${debugName}):` : 'withRetry:';

		return `${tag} ${message}`;
	}

	return (message: string) => messageFn(message, debugOptions);
}

async function withRetryImpl<T>(
	callback: () => Promise<T>,
	{ maxAttempts, shouldRetry, retryDelay, debugName }: WithRetryInternalOptions,
	logger?: WithRetryLogger
): Promise<T> {
	const msg = makeMessage({ debugName });

	logger?.debug({ maxAttempts }, msg('Starting with options'));

	if (maxAttempts === 1) {
		try {
			return await callback();
		} catch (err) {
			logger?.error({ err }, msg('Callback failed after 1 attempt.'));
			throw err;
		}
	}

	const errors: unknown[] = [];
	for (let i = 0; i < maxAttempts; ++i) {
		try {
			return await callback();
		} catch (err) {
			errors.push(err);
			if (shouldRetry(err)) {
				logger?.debug(
					{ err, attempt: i + 1, maxAttempts },
					msg('Callback failed and should be retried.')
				);
				await sleep(retryDelay(i));
			} else {
				logger?.debug(
					{ err, attempt: i + 1, maxAttempts },
					msg('Callback failed and should not be retried.')
				);
				throw err;
			}
		}
	}
	logger?.error({ errors }, 'withRetry: Callback failed too many times.');
	throw errors.at(-1);
}
