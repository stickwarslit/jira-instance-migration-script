import 'dotenv/config';

import assert from 'node:assert';

import FormData from 'form-data';
import type { Version3Models } from 'jira.js';
import { Version3Client } from 'jira.js';

const targetJiraEmail = process.env.TARGET_JIRA_EMAIL;
assert(targetJiraEmail, 'TARGET_JIRA_EMAIL is required');
const targetJiraApiToken = process.env.TARGET_JIRA_API_TOKEN;
assert(targetJiraApiToken, 'TARGET_JIRA_API_TOKEN is required');
const targetJiraHost = process.env.TARGET_JIRA_HOST;
assert(targetJiraHost, 'TARGET_JIRA_HOST is required');

const sourceJiraEmail = process.env.SOURCE_JIRA_EMAIL;
assert(sourceJiraEmail, 'SOURCE_JIRA_EMAIL is required');
const sourceJiraApiToken = process.env.SOURCE_JIRA_API_TOKEN;
assert(sourceJiraApiToken, 'SOURCE_JIRA_API_TOKEN is required');
const sourceJiraHost = process.env.SOURCE_JIRA_HOST;
assert(sourceJiraHost, 'SOURCE_JIRA_HOST is required');

export const sourceJiraClient = new Version3Client({
  host: sourceJiraHost,
  authentication: {
    basic: {
      email: sourceJiraEmail,
      apiToken: sourceJiraApiToken,
    },
  },
});
export const targetJiraClient = new Version3Client({
  host: targetJiraHost,
  authentication: {
    basic: {
      email: targetJiraEmail,
      apiToken: targetJiraApiToken,
    },
  },
});

export interface UploadAttachmentsToTargetJiraParams {
  key: string;
  files: {
    filename: string;
    contentType: string;
    buffer: Buffer;
  }[];
}

/**
 * The implementation of FormData upload used in `jira.js` is
 * borked so I wrote one out using chat gpt.
 */
export async function uploadAttachmentsToTargetJira({
  key,
  files,
}: UploadAttachmentsToTargetJiraParams): Promise<Version3Models.Attachment[]> {
  if (files.length === 0) return [];
  const formData = new FormData();
  for (const file of files) {
    formData.append('file', file.buffer, {
      filename: file.filename,
      contentType: file.contentType,
    });
  }
  return new Promise(
    (resolve, reject) =>
      void targetJiraClient.sendRequest<Version3Models.Attachment[]>(
        {
          url: `/rest/api/3/issue/${key}/attachments`,
          method: 'POST',
          headers: {
            'X-Atlassian-Token': 'no-check',
            // 'Content-Type': 'multipart/form-data',
            ...formData.getHeaders(),
          },
          data: formData,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        },
        (error, data) => {
          if (error) reject(error);
          if (!data) {
            reject(new Error('Attachments not created'));
          } else {
            resolve(data);
          }
        }
      )
  );
}

/**
 * Jira attachments have an attachment id, but in order to be referenced
 * in an Atlassian document (ex Description, Comment), you can't use the
 * attachment id (god forbid the jira api makes sense). Instead, you need
 * to use the jira media id.
 *
 * BUT, the best part is, Jira doesn't provide a public api for getting this
 * media id. Fun!
 *
 * I found a workaround from this atlassian forum post: https://community.developer.atlassian.com/t/how-to-work-with-attachments-in-comments-media-vs-attachments-nightmare/74338/3
 *
 * The gist is that the "Get attachment content" API endpoint is actually
 * a redirect to the Atlassian media servers. By observing parsing the
 * redirect response, we are able to get the media id to then use in
 * the description.
 */
export async function getAttachmentMediaId(
  client: Version3Client,
  attachmentId: string
) {
  const contentRes = await client.sendRequestFullResponse({
    url: `/rest/api/3/attachment/content/${attachmentId}`,
    method: 'HEAD',
    headers: {
      Accept: 'application/json',
    },
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const locationHeader = contentRes.headers.location;

  if (!locationHeader || typeof locationHeader !== 'string') return null;

  const match = locationHeader.match(uuidRegex);
  return match ? match[0] : null;
}

const uuidRegex =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
