import type { Version3Models } from 'jira.js';
import _ from 'lodash';

import type { Prisma, SourceIssue, SourceIssueAttachment } from './util/db';
import { getDb, SourceIssueType, SourceStatus } from './util/db';
import { isNotNullish } from './util/is-nullish';
import {
  getAttachmentMediaId,
  targetJiraClient,
  uploadAttachmentsToTargetJira,
} from './util/jira';
import { getTargetJiraPriority } from './util/jira-priority';
import { getS3FileContent } from './util/s3';
import { withRetry } from './util/with-retry';

const SOURCE_KEY = 'customfield_13582';

const sourceIssueIncludeData = {
  attachments: true,
  assignee: true,
  reporter: true,
  comments: { include: { author: true } },
} satisfies Prisma.SourceIssueInclude;
type SourceIssueWithData = Prisma.SourceIssueGetPayload<{
  include: typeof sourceIssueIncludeData;
}>;

const _TARGET_ISSUE_TYPES = [
  'Epic',
  'Task',
  'Sub-task',
  'Bug',
  'Story',
  'Tech Debt',
  'Requirement',
  'Test Case',
] as const;
type TargetIssueType = (typeof _TARGET_ISSUE_TYPES)[number];

const _TARGET_ISSUE_STATUSES = [
  'Canceled',
  'To Do',
  'Design',
  'In Progress',
  'Blocked',
  'QA Failed',
  'Smoke Test',
  'PR Review',
  'QA Ready',
  'QA Complete',
  'Completed',
  'Dev Ready',
  'On Hold',
] as const;
type TargetIssueStatus = (typeof _TARGET_ISSUE_STATUSES)[number];

async function main() {
  const prisma = await getDb();

  await addTargetJiraAccountIdToUsers();

  const targetProject = await targetJiraClient.projects.getProject({
    projectIdOrKey: 'TARGET',
  });

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

  const transitions = await targetJiraClient.issues.getTransitions({
    issueIdOrKey: 'TARGET-1',
  });

  let cursor = 0;
  let sourceDbIssues: SourceIssueWithData[] = [];

  do {
    sourceDbIssues = await prisma.sourceIssue.findMany({
      take: 10,
      skip: cursor,
      include: sourceIssueIncludeData,
    });
    for (const sourceDbIssue of sourceDbIssues) {
      const issueType = metaIssueTypes.find(
        (it) => it.name === sourceIssueTypeToTargetIssueType(sourceDbIssue.type)
      );
      if (!issueType) {
        continue;
      }
      const targetJiraIssue = await getOrCreateTargetJiraIssue({
        sourceDbIssue,
        targetJiraProject: targetProject,
        issueType,
      });

      const updatedAttachments = await uploadMissingAttachments(
        sourceDbIssue,
        targetJiraIssue
      );

      await uploadMissingComments(
        sourceDbIssue,
        targetJiraIssue,
        updatedAttachments
      );

      const fields = {
        summary: sourceDbIssue.summary,
        issuetype: issueType,
        // assignee:
        //   sourceDbIssue.assignee && sourceDbIssue.assignee.targetJiraAccountId
        //     ? {
        //         accountId: sourceDbIssue.assignee.targetJiraAccountId,
        //       }
        //     : undefined,
        reporter: sourceDbIssue.reporter?.targetJiraAccountId
          ? {
              accountId: sourceDbIssue.reporter.targetJiraAccountId,
            }
          : {
              // Fallback
              accountId: '6154bc5d9cdb9300722effa1',
            },
        [SOURCE_KEY]: sourceDbIssue.key,
        priority: getTargetJiraPriority(issueType, sourceDbIssue.priority),
        description: sourceDbIssue.description
          ? updateDocument(
              sourceDbIssue.description as unknown as Version3Models.Document,
              updatedAttachments
            )
          : undefined,
      };
      const transition = transitions.transitions?.find(
        (t) =>
          t.name === sourceIssueStatusToTargetIssueStatus(sourceDbIssue.status)
      );
      try {
        await targetJiraClient.issues.editIssue({
          issueIdOrKey: targetJiraIssue.id,
          fields,
          transition,
        });
      } catch (err) {
        console.error(err);
      }
    }

    cursor += sourceDbIssues.length;
  } while (sourceDbIssues.length > 0);
}

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
    if (maybeUser) {
      await prisma.sourceUser.update({
        where: { id: user.id },
        data: { targetJiraAccountId: maybeUser.accountId },
      });
    }
  }
}

function sourceIssueTypeToTargetIssueType(
  issueType: SourceIssueType
): TargetIssueType {
  switch (issueType) {
    case SourceIssueType.EPIC:
      return 'Epic';
    case SourceIssueType.TASK:
      return 'Task';
    case SourceIssueType.SUB_TASK:
      return 'Sub-task';
    case SourceIssueType.BUG:
      return 'Bug';
    case SourceIssueType.STORY:
      return 'Story';
    default:
      return 'Task';
  }
}

function sourceIssueStatusToTargetIssueStatus(
  issueStatus: SourceStatus
): TargetIssueStatus {
  switch (issueStatus) {
    case SourceStatus.QA_FAILED:
      return 'QA Failed';
    case SourceStatus.QA_PASSED:
      return 'QA Complete';
    case SourceStatus.CODE_MERGED:
    case SourceStatus.QA_READY:
      return 'QA Ready';
    case SourceStatus.BACKLOG:
    case SourceStatus.OPEN:
      return 'Dev Ready';
    case SourceStatus.CANCELLED:
    case SourceStatus.REJECTED:
      return 'Canceled';
    case SourceStatus.DONE:
      return 'Completed';
    case SourceStatus.IN_CODE_REVIEW:
      return 'PR Review';
    case SourceStatus.IN_PROGRESS:
      return 'In Progress';
    case SourceStatus.IN_REVIEW:
      return 'Design';
    case SourceStatus.TO_DO:
    default:
      return 'To Do';
  }
}

interface GetOrCreateTargetJiraIssueParams {
  sourceDbIssue: SourceIssue;
  targetJiraProject: Version3Models.Project;
  issueType: Version3Models.IssueTypeIssueCreateMetadata;
}

async function getOrCreateTargetJiraIssue({
  sourceDbIssue,
  targetJiraProject,
  issueType,
}: GetOrCreateTargetJiraIssueParams): Promise<Version3Models.Issue> {
  const initialPage = await searchTargetJiraBySourceKey(sourceDbIssue.key);
  if (initialPage.issues && initialPage.issues.length > 0) {
    console.log(`${sourceDbIssue.key}: Found existing TARGET Jira issue`);
    const targetJiraIssue = initialPage.issues[0]!;
    if (initialPage.issues.length > 1) {
      for (const issue of initialPage.issues.slice(1)) {
        await targetJiraClient.issues.deleteIssue({
          issueIdOrKey: issue.id,
          deleteSubtasks: true,
        });
      }
    }
    return targetJiraIssue;
  }
  console.log(`${sourceDbIssue.key}: Creating new TARGET Jira issue`);
  await targetJiraClient.issues.createIssue({
    fields: {
      project: {
        id: targetJiraProject.id,
      },
      summary: sourceDbIssue.summary,
      // description: sourceDbIssue.description,
      issuetype: issueType,
      [SOURCE_KEY]: sourceDbIssue.key,
    },
  });
  return await withRetry(
    async () => {
      const newPage = await searchTargetJiraBySourceKey(sourceDbIssue.key);
      if (newPage.issues && newPage.issues.length > 0) {
        console.log(`${sourceDbIssue.key}: Created new TARGET Jira issue`);
        return newPage.issues[0]!;
      } else {
        throw new Error('Failed to create issue');
      }
    },
    {
      maxAttempts: 6,
      retryDelay: (numRetriesSoFar) => 500 * Math.pow(2, numRetriesSoFar),
      debugName: `create-${sourceDbIssue.key}`,
    }
  );
}

async function searchTargetJiraBySourceKey(sourceKey: string) {
  return await targetJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost(
    {
      fields: ['attachment', 'comment'],
      expand: 'renderedFields',
      jql: `project = "TARGET" AND ${SOURCE_KEY} ~ "${sourceKey}"`,
    }
  );
}

async function uploadMissingAttachments(
  sourceDbIssue: SourceIssueWithData,
  targetJiraIssue: Version3Models.Issue
): Promise<SourceIssueAttachment[]> {
  const prisma = await getDb();
  const attachmentsWithContent = await Promise.all(
    sourceDbIssue.attachments.map(async (attachment) => {
      const file = await getS3FileContent(attachment.s3Key);
      if (!file) return null;

      const matchingAttachment = targetJiraIssue.fields.attachment.find(
        (ja) => ja.id === attachment.targetJiraId
      );
      if (matchingAttachment) return null;

      return {
        filename: attachment.filename ?? attachment.s3Key,
        buffer: Buffer.from(await file.transformToByteArray()),
        contentType: attachment.mimeType,
      };
    })
  );

  const newAttachmentsWithContent = attachmentsWithContent.filter(isNotNullish);
  if (newAttachmentsWithContent.length === 0) {
    return sourceDbIssue.attachments;
  }
  console.log(
    `${sourceDbIssue.key}: Uploading ${newAttachmentsWithContent.length} new attachments to TARGET Jira`
  );
  const newJiraAttachments = await uploadAttachmentsToTargetJira({
    key: targetJiraIssue.key,
    files: newAttachmentsWithContent,
  });

  const returnAttachments = _.cloneDeep(sourceDbIssue.attachments);
  for (const newJiraAttachment of newJiraAttachments) {
    const matchingAttachment = returnAttachments.find(
      (a) => a.filename === newJiraAttachment.filename
    );
    if (!matchingAttachment) continue;
    const mediaId = await getAttachmentMediaId(
      targetJiraClient,
      newJiraAttachment.id
    );
    await prisma.sourceIssueAttachment.update({
      where: { id: matchingAttachment.id },
      data: { targetJiraId: newJiraAttachment.id, targetJiraMediaId: mediaId },
    });
    matchingAttachment.targetJiraId = newJiraAttachment.id;
    matchingAttachment.targetJiraMediaId = mediaId;
  }

  return returnAttachments;
}

async function uploadMissingComments(
  sourceDbIssue: SourceIssueWithData,
  targetJiraIssue: Version3Models.Issue,
  attachments: SourceIssueAttachment[]
) {
  const prisma = await getDb();
  for (const dbComment of sourceDbIssue.comments) {
    if (dbComment.targetJiraId) continue;

    let commentBody: Version3Models.Document | undefined = undefined;
    if (dbComment.body) {
      const document = updateDocument(
        dbComment.body as unknown as Version3Models.Document,
        attachments
      );
      commentBody = {
        ...document,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: dbComment.author
                  ? `Originally posted in Source Jira board by ${dbComment.author.displayName} (${dbComment.author.email})`
                  : 'Originally posted in Source Jira board',
                marks: [
                  {
                    attrs: { type: 'sub' },
                    type: 'subsup',
                  },
                ],
              },
            ],
          },
          ...(document.content ?? []),
        ],
      };
    }

    const targetJiraComment = await targetJiraClient.issueComments.addComment({
      issueIdOrKey: targetJiraIssue.id,
      comment: commentBody,
    });
    await prisma.sourceIssueComment.update({
      where: { id: dbComment.id },
      data: { targetJiraId: targetJiraComment.id },
    });
  }
}

/**
 * Replace media ID's from Source attachments to TARGET attachments.
 */
function updateDocument(
  document: Version3Models.Document,
  attachments: SourceIssueAttachment[]
): Version3Models.Document {
  const lookup = _.keyBy(attachments, 'jiraMediaId');

  type DocumentNode = NonNullable<Version3Models.Document['content']>[number];
  function visit(node: DocumentNode): DocumentNode | null {
    const visitChildren = () =>
      node.content ? node.content.map(visit).filter(isNotNullish) : undefined;
    if (node.type === 'mediaSingle' && node.attrs) {
      return {
        type: 'mediaSingle',
        attrs: {
          layout: node.attrs?.layout ?? 'align-start',
        },
        content: visitChildren(),
      };
    }

    if (node.type === 'media' && node.attrs?.id) {
      const oldMediaId = node.attrs.id;
      const newId = lookup[oldMediaId]?.targetJiraMediaId;
      if (newId) {
        return {
          type: 'media',
          attrs: {
            type: 'file',
            collection: '',
            id: newId,
          },
        };
      } else {
        // Remove media since not found
        return null;
      }
    }
    return {
      ...node,
      content: visitChildren(),
    };
  }

  return {
    type: 'doc',
    version: 1,
    content: (document.content ?? []).map(visit).filter(isNotNullish),
  };
}

void main();
