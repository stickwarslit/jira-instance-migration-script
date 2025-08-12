import type { Version3Models } from 'jira.js';

import { getDb } from './util/db';
import { isNotNullish } from './util/is-nullish';
import {
  getAttachmentMediaId,
  sourceJiraClient,
  targetJiraClient,
} from './util/jira';

async function addTargetJiraAccountIdToUsers() {
  const prisma = await getDb();
  const users = await prisma.sourceUser.findMany({
    where: { targetJiraAccountId: null, email: { not: null } },
  });
  for (const user of users) {
    const userEmail = user.email;
    if (!userEmail) continue;
    const res = await targetJiraClient.userSearch.findUsers({
      query: userEmail,
    });
    const maybeUser = res.find((u) => u.emailAddress === userEmail);
  }
}

async function getIssue() {
  const targetIssue = await targetJiraClient.issues.getIssue({
    issueIdOrKey: 'TARGET-280',
  });
  const sourceIssue = await sourceJiraClient.issues.getIssue({
    issueIdOrKey: 'SOURCE-1839',
  });
  const thing = 'blah';
}

async function getIssueInProject() {
  const page: Version3Models.SearchAndReconcileResults =
    await sourceJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost(
      {
        fields: [
          'assignee',
          'summary',
          'created',
          'reporter',
          'creator',
          'description',
          'issuetype',
          'status',
          'parent',
          'priority',
          'attachment',
        ],
        expand: 'renderedFields',
        jql: 'project = "TARGET"',
      }
    );
}

async function getMediaId() {
  const mediaId = await getAttachmentMediaId(sourceJiraClient, '71534');
}

async function getCreateIssueMeta() {
  const metaIssueTypesInfo =
    await targetJiraClient.issues.getCreateIssueMetaIssueTypes({
      projectIdOrKey: 'TARGET',
    });
  const metaIssueTypes = (
    await Promise.all(
      (metaIssueTypesInfo.issueTypes ?? []).map(async (miti) => {
        const issueTypeId = miti.id;
        if (!issueTypeId) return null;
        const fullIssueData =
          await targetJiraClient.issues.getCreateIssueMetaIssueTypeId({
            issueTypeId,
            projectIdOrKey: 'TARGET',
          });
        return { ...miti, ...fullIssueData };
      })
    )
  ).filter(isNotNullish);
  console.log(metaIssueTypes);
}

async function getTransitions() {
  const transitions = await targetJiraClient.issues.getTransitions({
    issueIdOrKey: 'TARGET-151',
  });
  console.log(transitions);
}

async function main() {
  try {
    await getIssue();
  } catch (err) {
    console.error(err);
  }
}

void main();
