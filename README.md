# Jira Instance Migration

This repository provides tools and scripts to facilitate the migration of issues, users, attachments, and related data between two Jira instances. It leverages Prisma ORM for database management, the `jira.js` library for Jira API interactions, and AWS S3 for attachment storage.

## Features

- **Pull from Source Jira**: Extracts issues, users, comments, and attachments from a source Jira instance and stores them in a local SQLite database.
- **Push to Target Jira**: Migrates the stored data to a target Jira instance, including mapping users, issue types, statuses, and uploading attachments.
- **Attachment Handling**: Downloads attachments from the source Jira and uploads them to AWS S3, then reattaches them to issues in the target Jira.
- **User Mapping**: Attempts to match users between instances by email and updates account IDs accordingly.

## Project Structure

- `src/pull.ts` — Script to pull data from the source Jira instance.
- `src/push.ts` — Script to push data to the target Jira instance.
- `src/util/` — Helper modules for database, Jira API, S3, and other utilities.
- `prisma/schema.prisma` — Prisma schema for the local SQLite database.

## Setup

1. **Install dependencies:**
   ```sh
   pnpm install
   ```
2. **Configure environment:**
   - Create a `.env` file with credentials for Jira and AWS S3 as required by the utility modules.
3. **Generate Prisma client:**
   ```sh
   pnpm prisma generate
   ```
4. **Run migrations (if needed):**
   ```sh
   pnpm prisma migrate dev
   ```

## Usage

- **Pull data from source Jira:**
  ```sh
  pnpm pull
  ```
- **Push data to target Jira:**
  ```sh
  pnpm push
  ```

## Configuration

- Update JQL queries and project keys in `src/pull.ts` and `src/push.ts` as needed for your migration scenario.
- Ensure AWS S3 and Jira credentials are set in your environment variables or in a `.env` file

## Technologies Used

- [TypeScript](https://www.typescriptlang.org/)
- [Prisma ORM](https://www.prisma.io/)
- [jira.js](https://github.com/MrRefactoring/jira.js)
- [AWS SDK for S3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)
- [SQLite](https://www.sqlite.org/index.html)
