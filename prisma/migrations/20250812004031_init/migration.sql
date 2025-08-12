-- CreateTable
CREATE TABLE "SourceIssue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "parentKey" TEXT,
    "assigneeId" INTEGER,
    "reporterId" INTEGER,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    CONSTRAINT "SourceIssue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "SourceUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SourceIssue_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "SourceUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceIssueComment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jiraId" TEXT NOT NULL,
    "body" JSONB,
    "targetJiraId" TEXT,
    "issueId" INTEGER NOT NULL,
    "authorId" INTEGER,
    CONSTRAINT "SourceIssueComment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "SourceIssue" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceIssueComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "SourceUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceIssueAttachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "filename" TEXT,
    "mimeType" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "jiraId" TEXT,
    "jiraMediaId" TEXT,
    "targetJiraId" TEXT,
    "targetJiraMediaId" TEXT,
    "issueId" INTEGER NOT NULL,
    CONSTRAINT "SourceIssueAttachment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "SourceIssue" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceRelease" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SourceUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accountId" TEXT NOT NULL,
    "targetJiraAccountId" TEXT,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "_FixVersions" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_FixVersions_A_fkey" FOREIGN KEY ("A") REFERENCES "SourceIssue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_FixVersions_B_fkey" FOREIGN KEY ("B") REFERENCES "SourceRelease" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceIssue_key_key" ON "SourceIssue"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SourceIssueComment_jiraId_key" ON "SourceIssueComment"("jiraId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRelease_name_key" ON "SourceRelease"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SourceUser_accountId_key" ON "SourceUser"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "_FixVersions_AB_unique" ON "_FixVersions"("A", "B");

-- CreateIndex
CREATE INDEX "_FixVersions_B_index" ON "_FixVersions"("B");
