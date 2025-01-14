import * as semver from "https://deno.land/std@0.189.0/semver/mod.ts";
import { getPrBranchName } from "./git.ts";
import { GiteaVersion } from "./giteaVersion.ts";

const GITHUB_API = "https://api.github.com";
const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${Deno.env.get("BACKPORTER_GITHUB_TOKEN")}`,
};

// return the current user
export const fetchCurrentUser = async () => {
  const response = await fetch(`${GITHUB_API}/user`, { headers: HEADERS });
  return response.json();
};

// returns a list of PRs that are merged and have the backport label for the current Gitea version
export const fetchCandidates = async (giteaMajorMinorVersion: string) => {
  const response = await fetch(
    `${GITHUB_API}/search/issues?q=` +
      encodeURIComponent(
        `is:pr is:merged base:main label:backport/v${giteaMajorMinorVersion} -label:backport/done -label:backport/manual repo:go-gitea/gitea`,
      ),
    { headers: HEADERS },
  );
  const json = await response.json();
  return json;
};

// returns a list of PRs that are merged and have the given label
export const fetchMergedWithLabel = async (label: string) => {
  const response = await fetch(
    `${GITHUB_API}/search/issues?q=` +
      encodeURIComponent(
        `is:pr is:merged label:${label} repo:go-gitea/gitea`,
      ),
    { headers: HEADERS },
  );
  const json = await response.json();
  return json;
};

// returns a list of open issues with the given label
export const fetchOpenIssuesWithLabel = async (label: string) => {
  const response = await fetch(
    `${GITHUB_API}/search/issues?q=` +
      encodeURIComponent(
        `is:issue is:open label:${label} repo:go-gitea/gitea`,
      ),
    { headers: HEADERS },
  );
  const json = await response.json();
  return json;
};

// returns a list of PRs pending merge (have the label reviewed/wait-merge)
export const fetchPendingMerge = async () => {
  const response = await fetch(
    `${GITHUB_API}/search/issues?q=` +
      encodeURIComponent(
        `is:pr is:open label:reviewed/wait-merge sort:created-asc repo:go-gitea/gitea`,
      ),
    { headers: HEADERS },
  );
  const json = await response.json();
  return json;
};

// returns a list of PRs that target the given branch
export const fetchTargeting = async (branch: string) => {
  const response = await fetch(
    `${GITHUB_API}/search/issues?q=` +
      encodeURIComponent(
        `is:pr base:${branch} repo:go-gitea/gitea`,
      ),
    { headers: HEADERS },
  );
  const json = await response.json();
  return json;
};

// returns a list of closed PRs that have the given milestone
export const fetchUnmergedClosedWithMilestone = async (
  milestoneTitle: string,
) => {
  const response = await fetch(
    `${GITHUB_API}/search/issues?q=` +
      encodeURIComponent(
        `is:pr is:closed is:unmerged milestone:${milestoneTitle} repo:go-gitea/gitea`,
      ),
    { headers: HEADERS },
  );
  const json = await response.json();
  return json;
};

// returns a list of breaking PRs that don't have the label kind/breaking
export const fetchBreakingWithoutLabel = async () => {
  const response = await fetch(
    `${GITHUB_API}/search/issues?q=` +
      encodeURIComponent(
        `is:pr "## :warning: BREAKING" -label:kind/breaking repo:go-gitea/gitea`,
      ),
    { headers: HEADERS },
  );
  const json = await response.json();
  return json;
};

// returns a list of files changed in the given PR number
export const fetchPrFileNames = async (prNumber: number) => {
  const files: { filename: string }[] = [];
  let page = 1;
  while (true) {
    const response = await fetch(
      `${GITHUB_API}/repos/go-gitea/gitea/pulls/${prNumber}/files?per_page=100&page=${page}`,
      { headers: HEADERS },
    );
    const json = await response.json();
    files.push(...json);
    if (json.length < 100) {
      break;
    }
    page++;
  }
  return new Set(files.map((file) => file.filename));
};

// update a given PR with the latest upstream changes by merging HEAD from
// the base branch into the pull request branch
export const updatePr = async (prNumber: number): Promise<Response> => {
  const pr = await fetchPr(prNumber);
  const response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/pulls/${prNumber}/update-branch`,
    {
      method: "PUT",
      headers: HEADERS,
      body: JSON.stringify({ expected_head_sha: pr.head.sha }),
    },
  );
  return response;
};

// sets a commit status
export const setCommitStatus = (
  sha: string,
  state: "error" | "failure" | "pending" | "success",
  description: string,
) => {
  return fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/statuses/${sha}`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        state,
        context: "giteabot/lgtm",
        description,
      }),
    },
  );
};

// get a go-gitea/gitea branch
export const fetchBranch = async (branch: string) => {
  const response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/branches/${branch}`,
    { headers: HEADERS },
  );
  return response.json();
};

// checks if the given PR needs to be updated
export const needsUpdate = async (prNumber: number) => {
  // get the PR and check if its base sha is the same as its base branch
  const pr = await fetchPr(prNumber);

  // if maintainers can't modify the PR, it doesn't need to be updated
  if (!pr.maintainer_can_modify) return false;

  // if the PR is not open, it doesn't need to be updated
  if (pr.state !== "open") return false;

  const base = await fetchBranch(pr.base.ref);
  return pr.base.sha !== base.commit.sha;
};

// given a PR number that has the given label, remove the label
export const removeLabel = async (
  prNumber: number,
  label: string,
) => {
  const response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/issues/${prNumber}/labels/${label}`,
    { method: "DELETE", headers: HEADERS },
  );
  return response;
};

// returns the PR
export const fetchPr = async (prNumber: number) => {
  const response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/pulls/${prNumber}`,
    { headers: HEADERS },
  );
  return response.json();
};

// sets the milestone of the given PR
export const setMilestone = (prNumber: number, milestone: number) => {
  return fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/issues/${prNumber}`,
    {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify({ milestone }),
    },
  );
};

// removes the milestone of the given PR
export const removeMilestone = (prNumber: number) => {
  return fetch(`${GITHUB_API}/repos/go-gitea/gitea/issues/${prNumber}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({ milestone: null }),
  });
};

// returns true if a backport PR exists for the given PR number and Gitea version
export const backportPrExists = async (
  pr: { number: number },
  giteaMajorMinorVersion: string,
) => {
  const response = await fetch(
    `${GITHUB_API}/search/issues?q=` +
      encodeURIComponent(
        `is:pr is:open repo:go-gitea/gitea base:release/v${giteaMajorMinorVersion} ${pr.number} in:title`,
      ),
    { headers: HEADERS },
  );
  const json = await response.json();
  return json.total_count > 0;
};

type Milestone = { title: string; number: number };

// get Gitea milestones
export const getMilestones = async (): Promise<Milestone[]> => {
  const response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/milestones`,
    { headers: HEADERS },
  );
  const json = await response.json();
  const milestones: Milestone[] = json.filter((m: Milestone) =>
    semver.valid(m.title)
  );

  // take only the earliest patch version of each minor version (e.g. 1.19.0, 1.19.1, 1.19.2 -> 1.19.0)
  const earliestPatchVersions: Record<string, Milestone> = {};
  for (const milestone of milestones) {
    const version = new semver.SemVer(milestone.title);
    const key = `${version.major}.${version.minor}`;
    if (
      !earliestPatchVersions[key] ||
      semver.lt(milestone.title, earliestPatchVersions[key].title)
    ) {
      earliestPatchVersions[key] = milestone;
    }
  }

  return Object.values(earliestPatchVersions);
};

export const getPrReviewers = async (
  pr: { number: number; requested_reviewers: { login: string }[] },
): Promise<{ approvers: Set<string>; blockers: Set<string> }> => {
  // load all reviews
  const reviews: {
    state:
      | "APPROVED"
      | "CHANGES_REQUESTED"
      | "COMMENTED"
      | "DISMISSED"
      | "PENDING";
    user: { login: string };
  }[] = [];
  let page = 1;
  while (true) {
    const response = await fetch(
      `${GITHUB_API}/repos/go-gitea/gitea/pulls/${pr.number}/reviews?per_page=100&page=${page}`,
      { headers: HEADERS },
    );
    if (!response.ok) throw new Error(await response.text());
    const results: [] = await response.json();
    if (results.length === 0) break;
    reviews.push(...results);
    page++;
  }

  // count approvers and blockers by replaying all reviews (they are already sorted)
  const approvers = new Set<string>();
  const blockers = new Set<string>();
  for (const review of reviews) {
    switch (review.state) {
      case "APPROVED":
        approvers.add(review.user.login);
        blockers.delete(review.user.login);
        break;
      case "DISMISSED":
        approvers.delete(review.user.login);
        blockers.delete(review.user.login);
        break;
      case "CHANGES_REQUESTED":
        approvers.delete(review.user.login);
        blockers.add(review.user.login);
        break;
      default:
        break;
    }
  }

  // any requested reviewers are not approvers
  for (const requestedReviewer of pr.requested_reviewers) {
    approvers.delete(requestedReviewer.login);
  }

  return { approvers, blockers };
};

export const createBackportPr = async (
  originalPr: {
    title: string;
    number: number;
    body: string;
    labels: [{ name: string }];
    user: { login: string };
    requested_reviewers: { login: string }[];
  },
  giteaVersion: GiteaVersion,
) => {
  let prDescription =
    `Backport #${originalPr.number} by @${originalPr.user.login}`;
  if (originalPr.body) {
    prDescription += "\n\n" + originalPr.body;
  }
  let response = await fetch(`${GITHUB_API}/repos/go-gitea/gitea/pulls`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      title: `${originalPr.title} (#${originalPr.number})`,
      head: `${Deno.env.get("BACKPORTER_GITEA_FORK")?.split("/")[0]}:${
        getPrBranchName(
          originalPr.number,
          giteaVersion.majorMinorVersion,
        )
      }`,
      base: `release/v${giteaVersion.majorMinorVersion}`,
      body: prDescription,
      maintainer_can_modify: true,
    }),
  });
  const json = await response.json();

  // filter lgtm/*, backport/*, reviewed/*, and size/* labels
  const labels = originalPr.labels
    .map((label) => label.name)
    .filter((label) => {
      return (
        !label.startsWith("lgtm/") &&
        !label.startsWith("backport/") &&
        !label.startsWith("reviewed/") &&
        !label.startsWith("size/")
      );
    });

  // add labels
  response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/issues/${json.number}/labels`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ labels }),
    },
  );

  // set assignee
  await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/issues/${json.number}`,
    {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify({
        assignees: [originalPr.user.login],
      }),
    },
  );

  // request review from original PR approvers
  const { approvers } = await getPrReviewers(originalPr);
  await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/pulls/${json.number}/requested_reviewers`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ reviewers: [...approvers] }),
    },
  );

  // if the original PR had exactly one backport/* label, add the backport/done label to it
  const backportLabels = originalPr.labels
    .filter((label) => label.name.startsWith("backport/"));
  if (backportLabels.length === 1) {
    await addLabels(originalPr.number, ["backport/done"]);
    console.log(`Added backport/done label to PR #${originalPr.number}`);
  }
};

export const addLabels = async (prNumber: number, labels: string[]) => {
  const response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/issues/${prNumber}/labels`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ labels: labels }),
    },
  );
  await response.json();
};

export const addComment = async (issueNumber: number, comment: string) => {
  const response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ body: comment }),
    },
  );
  await response.json();
  console.info(`Added comment to #${issueNumber}`);
};

// locks a given issue
export const lockIssue = async (
  issueNumber: number,
  reason: "off-topic" | "too heated" | "resolved" | "spam",
) => {
  const response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/issues/${issueNumber}/lock`,
    {
      method: "PUT",
      headers: HEADERS,
      body: JSON.stringify({ lock_reason: reason }),
    },
  );
  if (!response.ok) {
    console.error(
      `Failed to lock issue #${issueNumber}: ${await response.text()}`,
    );
    return false;
  }
  console.info(`Locked issue #${issueNumber}`);
  return true;
};

// returns issues that are unlocked, closed and have been closed before the given date. Only the first 30 results are returned.
export const fetchClosedOldIssuesAndPRs = async (before: Date) => {
  // if we ever become a GitHub app, we need to separate the search query into
  // two queries, one for issues and one for PRs, and then merge the results
  const response = await fetch(
    `${GITHUB_API}/search/issues?q=` +
      encodeURIComponent(
        `is:closed is:unlocked closed:<${before.toISOString()} repo:go-gitea/gitea`,
      ),
    { headers: HEADERS },
  );
  const json = await response.json();
  return json;
};

// returns the last comment of the given issue
export const fetchLastComment = async (issueNumber: number) => {
  const response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/issues/${issueNumber}/comments?per_page=1&sort=created&direction=desc`,
    { headers: HEADERS },
  );
  const json = await response.json();
  if (!json.length) return null;
  return json[0];
};

// closes the given issue
export const closeIssue = async (issueNumber: number) => {
  const response = await fetch(
    `${GITHUB_API}/repos/go-gitea/gitea/issues/${issueNumber}`,
    {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify({ state: "closed" }),
    },
  );
  return response.json();
};
