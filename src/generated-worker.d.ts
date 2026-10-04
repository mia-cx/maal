declare module '*cloudflare/_worker.js' {
	const worker: {
		fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
	};

	export default worker;
}
