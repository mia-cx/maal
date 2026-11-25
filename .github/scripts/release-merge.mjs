import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only a merged release pull request from this repository authorizes a production deploy of this exact commit. */
export const isReleaseMerge = (pullRequests, { sha, repository }) =>
	Boolean(releasePullRequest(pullRequests, { sha, repository }));

/** Find the merged release PR whose exact commit authorizes production and validation reuse. */
export const releasePullRequest = (pullRequests, { sha, repository }) =>
	pullRequests.find(
		(pr) =>
			typeof pr.merged_at === 'string' &&
			pr.merge_commit_sha === sha &&
			pr.base?.ref === 'main' &&
			pr.base?.repo?.full_name === repository &&
			pr.head?.ref === 'changeset-release/main' &&
			pr.head?.repo?.full_name === repository
	);

/** Match the workflow and PR head identity; GitHub clears run.pull_requests after merging. */
export const releaseValidated = (workflowRuns, pullRequest) =>
	workflowRuns.some(
		(run) =>
			run.event === 'pull_request' &&
			run.path?.split('@')[0] === '.github/workflows/release-validation.yml' &&
			run.head_sha === pullRequest.head.sha &&
			run.head_branch === pullRequest.head.ref &&
			run.head_repository?.full_name === pullRequest.head.repo.full_name &&
			run.status === 'completed' &&
			run.conclusion === 'success'
	);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// Errors propagate to the CLI boundary, where they require fresh checks rather than block deployment.
const validatedReleaseTree = (pullRequests, { sha, repository }) => {
	if (
		process.env.GITHUB_EVENT_NAME !== 'push' ||
		process.env.GITHUB_REF !== 'refs/heads/main' ||
		process.env.GITHUB_SHA !== sha
	)
		return false;
	const pr = releasePullRequest(pullRequests, { sha, repository });
	if (!pr?.head?.sha) return false;
	const pages = JSON.parse(
		execFileSync(
			'gh',
			[
				'api',
				`repos/${repository}/actions/workflows/release-validation.yml/runs?event=pull_request&head_sha=${pr.head.sha}&status=success&per_page=100`,
				'--paginate',
				'--slurp'
			],
			{ encoding: 'utf8' }
		)
	);
	if (
		!releaseValidated(
			pages.flatMap((page) => page.workflow_runs),
			pr
		)
	)
		return false;
	// Squash merges and deleted branches can leave the PR head outside the checkout.
	git('fetch', '--no-tags', 'origin', `refs/pull/${pr.number}/head`);
	return git('rev-parse', `${sha}^{tree}`) === git('rev-parse', `${pr.head.sha}^{tree}`);
};

// Reads paginated `commits/{sha}/pulls` on stdin. The validated mode also verifies the tested tree.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [sha, repository, mode] = process.argv.slice(2);
	if (!sha || !repository) throw new Error('release-merge needs a commit SHA and repository');
	if (mode === 'validated') {
		let validated = false;
		try {
			const pullRequests = JSON.parse(readFileSync(0, 'utf8')).flat();
			validated = validatedReleaseTree(pullRequests, { sha, repository });
		} catch (cause) {
			console.warn(
				'::warning::Unable to reuse release PR validation; requiring fresh checks.',
				cause.message
			);
		}
		process.stdout.write(`validated=${validated}\n`);
		if (process.env.GITHUB_OUTPUT)
			appendFileSync(process.env.GITHUB_OUTPUT, `validated=${validated}\n`);
	} else {
		const pages = JSON.parse(readFileSync(0, 'utf8'));
		process.stdout.write(`${isReleaseMerge(pages.flat(), { sha, repository })}\n`);
	}
}
