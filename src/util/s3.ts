import 'dotenv/config';

import assert from 'node:assert';

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';

const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const bucket = process.env.AWS_S3_BUCKET;
assert(accessKeyId, 'AWS_ACCESS_KEY_ID is not defined');
assert(secretAccessKey, 'AWS_SECRET_ACCESS_KEY is not defined');
assert(bucket, 'AWS_S3_BUCKET is not defined');

const client = new S3Client({
  region: 'us-east-2',
  credentials: {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },
});

export async function uploadFileToS3(body: Buffer, contentType: string) {
  const key = nanoid();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
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
      Bucket: bucket,
      Key: key,
    })
  );
  return res.Body;
}
