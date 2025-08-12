import _ from 'lodash';
import type { Simplify } from 'type-fest';

type OmitUndefined<T extends object> = Simplify<
	{
		[K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
			T[K],
			undefined
		>;
	} & {
		[K in keyof T as undefined extends T[K] ? never : K]: T[K];
	}
>;

/**
 * Remove all undefined props from the object.
 */
export function omitUndefined<T extends object>(
	object: T | null | undefined
): OmitUndefined<T> {
	return _.omitBy<T>(object, _.isUndefined) as OmitUndefined<T>;
}
