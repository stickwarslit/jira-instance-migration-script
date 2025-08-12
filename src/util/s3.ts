import 'dotenv/config';

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';

const client = new S3Client({
  region: 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },
});

export async function uploadFileToS3(body: Buffer, contentType: string) {
  const key = nanoid();
  await client.send(
    new PutObjectCommand({
      Bucket: 'source-target-jira-backup',
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

export async function getS3FileContent(key: string) {
  const res = await client.send(
    new GetObjectCommand({
      Bucket: 'source-target-jira-backup',
      Key: key,
    })
  );
  return res.Body;
}
