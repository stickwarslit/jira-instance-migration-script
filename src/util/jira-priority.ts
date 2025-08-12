import type { Version3Models } from 'jira.js';
import type { Infer } from 'superstruct';
import { array, mask, object, optional, string } from 'superstruct';

import { SourcePriority } from './db';

const _TARGET_PRIORITIES = ['Blocker', 'High', 'Medium', 'Low'] as const;
type TargetPriority = (typeof _TARGET_PRIORITIES)[number];

const AllowedValueStruct = object({
  id: string(),
  name: optional(string()),
  value: optional(string()),
});
type AllowedValue = Infer<typeof AllowedValueStruct>;
const IssueTypeMetadataFieldsStruct = array(
  object({
    allowedValues: optional(array(AllowedValueStruct)),
    key: string(),
    name: string(),
  })
);

function getPriorityOptions(
  issueCreateMetadata: Version3Models.IssueTypeIssueCreateMetadata
): AllowedValue[] {
  try {
    // The jira api doesnt type this field for some reason
    const fields = mask(
      issueCreateMetadata.fields,
      IssueTypeMetadataFieldsStruct
    );
    const priorityField = fields.find((f) => f.key === 'priority');
    return priorityField?.allowedValues ?? [];
  } catch (err) {
    console.log('Error getting priority options:', err);
    return [];
  }
}

export function getTargetJiraPriority(
  issueCreateMetadata: Version3Models.IssueTypeIssueCreateMetadata,
  sourcePriority: SourcePriority
): AllowedValue | undefined {
  const priorityOptions = getPriorityOptions(issueCreateMetadata);
  const priority = priorityOptions.find(
    (po) => po.name === sourcePriorityToTargetPriority(sourcePriority)
  );
  return priority;
}

function sourcePriorityToTargetPriority(
  priority: SourcePriority
): TargetPriority {
  switch (priority) {
    case SourcePriority.BLOCKER:
    case SourcePriority.CRITICAL:
      return 'Blocker';
    case SourcePriority.HIGH:
    case SourcePriority.HIGHEST:
    case SourcePriority.MAJOR:
      return 'High';
    case SourcePriority.MEDIUM:
      return 'Medium';
    case SourcePriority.LOW:
    case SourcePriority.LOWEST:
    case SourcePriority.TRIVIAL:
    case SourcePriority.MINOR:
      return 'Low';
    default:
      return 'Medium';
  }
}
