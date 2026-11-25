/**
 * Wraps a D1 database so `between` runs once, right after the first statement whose SQL contains
 * `sqlFragment` resolves `.first()`. Use it to land a concurrent commit between two reads of one
 * repository call, deterministically.
 */
export const commitBetweenReads = (
	database: D1Database,
	sqlFragment: string,
	between: () => Promise<unknown>
): D1Database => {
	let ran = false;
	const forward = <T extends object>(target: T, property: string | symbol) => {
		const value = Reflect.get(target, property);
		return typeof value === 'function' ? value.bind(target) : value;
	};
	const interceptFirst = (bound: D1PreparedStatement): D1PreparedStatement =>
		new Proxy(bound, {
			get: (target, property) =>
				property !== 'first'
					? forward(target, property)
					: async (...args: Parameters<D1PreparedStatement['first']>) => {
							const result = await target.first(...args);
							if (!ran) {
								ran = true;
								await between();
							}
							return result;
						}
		});
	return new Proxy(database, {
		get: (target, property) =>
			property !== 'prepare'
				? forward(target, property)
				: (sql: string) => {
						const statement = target.prepare(sql);
						if (!sql.includes(sqlFragment)) return statement;
						return new Proxy(statement, {
							get: (inner, innerProperty) =>
								innerProperty !== 'bind'
									? forward(inner, innerProperty)
									: (...values: unknown[]) => interceptFirst(inner.bind(...values))
						});
					}
	});
};
