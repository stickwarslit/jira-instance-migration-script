import type { Version3Models, Version3Parameters } from 'jira.js';

import type { Prisma } from './util/db';
import {
  getDb,
  SourceIssueType,
  SourcePriority,
  SourceStatus,
} from './util/db';
import { isNotNullish } from './util/is-nullish';
import { getAttachmentMediaId, sourceJiraClient } from './util/jira';
import { uploadFileToS3 } from './util/s3';

async function main() {
  await pullIssues();
}

async function pullIssues() {
  let nextPageToken: string | undefined = undefined;
  let numProcessed = 0;

  const baseParams = {
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
      'comment',
    ],
    expand: 'renderedFields',
    jql: 'project = "TARGET" AND key = TARGET-1839',
  } satisfies Version3Parameters.SearchForIssuesUsingJqlEnhancedSearchPost;

  do {
    console.log('Processed: ', numProcessed);
    const page: Version3Models.SearchAndReconcileResults =
      await sourceJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost(
        {
          ...baseParams,
          nextPageToken,
        }
      );

    for (const issue of page.issues ?? []) {
      await processIssue(issue);
    }

    numProcessed += page.issues?.length ?? 0;
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
}

async function processIssue(issue: Version3Models.Issue) {
  const prisma = await getDb();
  const data = {
    summary: issue.fields.summary,
    createdAt: new Date(issue.fields.created),
    parentKey: issue.fields.parent?.key,
    assignee: processUser(issue.fields.assignee),
    reporter: processUser(issue.fields.reporter),
    status: processStatus(issue.fields.status),
    type: processIssueType(issue.fields.issuetype ?? issue.fields.issueType),
    priority: processIssuePriority(issue.fields.priority),
    description: issue.fields.description as object,
    comments: {
      connectOrCreate: issue.fields.comment.comments
        .map((c) =>
          c.id
            ? {
                where: { jiraId: c.id },
                create: {
                  body: c.body as object,
                  jiraId: c.id,
                  author: processUser(c.author),
                },
              }
            : null
        )
        .filter(isNotNullish),
    },
  } satisfies Prisma.SourceIssueUpdateInput;
  await prisma.sourceIssue.upsert({
    where: { key: issue.key },
    create: {
      key: issue.key,
      ...data,
    },
    update: {
      ...data,
    },
  });
  await processAttachments(issue);
}

function processUser(user: Version3Models.UserDetails | undefined) {
  const accountId = user?.accountId;
  if (!user || !accountId) {
    return undefined;
  }
  return {
    connectOrCreate: {
      where: { accountId },
      create: {
        accountId,
        email: user.emailAddress,
        displayName: user.displayName,
      },
    },
  } satisfies Prisma.SourceUserCreateNestedOneWithoutAssignedIssuesInput;
}

function processStatus(status: Version3Models.StatusDetails): SourceStatus {
  switch (status.name) {
    case 'Backlog':
      return SourceStatus.BACKLOG;
    case 'Cancelled':
      return SourceStatus.CANCELLED;
    case 'CODE MERGED (DEV TEST)':
      return SourceStatus.CODE_MERGED;
    case 'Done':
      return SourceStatus.DONE;
    case 'In Code Review':
      return SourceStatus.IN_CODE_REVIEW;
    case 'In Progress':
      return SourceStatus.IN_PROGRESS;
    case 'In Review':
      return SourceStatus.IN_REVIEW;
    case 'Open':
      return SourceStatus.OPEN;
    case 'QA Ready':
      return SourceStatus.QA_READY;
    case 'Rejected':
      return SourceStatus.REJECTED;
    case 'To Do':
      return SourceStatus.TO_DO;
    default: {
      return SourceStatus.BACKLOG;
    }
  }
}

function processIssueType(
  issueType: Version3Models.IssueTypeDetails | undefined
): SourceIssueType {
  switch (issueType?.name) {
    case 'Sub-task':
      return SourceIssueType.SUB_TASK;
    case 'Task':
      return SourceIssueType.TASK;
    case 'Bug':
      return SourceIssueType.BUG;
    case 'Story':
      return SourceIssueType.STORY;
    case 'Epic':
      return SourceIssueType.EPIC;
    default:
      return SourceIssueType.TASK;
  }
}

function processIssuePriority(
  priority: Version3Models.Priority
): SourcePriority {
  // Lowest, Low, Medium, High, Highest, Trivial, Minor, Critical, Blocker, Major
  switch (priority.name) {
    case 'Lowest':
      return SourcePriority.LOWEST;
    case 'Low':
      return SourcePriority.LOW;
    case 'Medium':
      return SourcePriority.MEDIUM;
    case 'High':
      return SourcePriority.HIGH;
    case 'Highest':
      return SourcePriority.HIGHEST;
    case 'Trivial':
      return SourcePriority.TRIVIAL;
    case 'Minor':
      return SourcePriority.MINOR;
    case 'Critical':
      return SourcePriority.CRITICAL;
    case 'Blocker':
      return SourcePriority.BLOCKER;
    case 'Major':
      return SourcePriority.MAJOR;
    default:
      return SourcePriority.MEDIUM;
  }
}

async function processAttachments(issue: Version3Models.Issue) {
  const prisma = await getDb();
  const dbIssueAttachments = await prisma.sourceIssueAttachment.findMany({
    where: { issue: { key: issue.key } },
  });

  for (const jiraAttachment of issue.fields.attachment) {
    // mimeType is required when creating a new attachment
    const mimeType = jiraAttachment.mimeType;
    if (!mimeType) continue;

    const matchingDbAttachment = dbIssueAttachments.find(
      (dia) =>
        dia.jiraId === jiraAttachment.id ||
        dia.filename === jiraAttachment.filename
    );
    if (matchingDbAttachment) continue;

    console.log(
      `${issue.key}: Processing attachment ${jiraAttachment.filename} (${jiraAttachment.id})`
    );
    const content =
      await sourceJiraClient.issueAttachments.getAttachmentContent({
        id: jiraAttachment.id,
      });
    const s3Key = await uploadFileToS3(content, mimeType);
    const mediaId = await getAttachmentMediaId(
      sourceJiraClient,
      jiraAttachment.id
    );
    await prisma.sourceIssueAttachment.create({
      data: {
        filename: jiraAttachment.filename,
        mimeType,
        s3Key,
        jiraId: jiraAttachment.id,
        jiraMediaId: mediaId,
        issue: {
          connect: {
            key: issue.key,
          },
        },
      },
    });
  }
}

void main();
