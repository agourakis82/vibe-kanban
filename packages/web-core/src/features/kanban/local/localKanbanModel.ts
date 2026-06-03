import type { KanbanCardContentProps } from '@vibe/ui/components/KanbanCardContent';
import type {
  LocalTask,
  LocalTaskStatus,
} from '@/shared/hooks/useLocalProjectTasks';

/**
 * Fixed local kanban columns.
 *
 * The pre-sunset cloud board derived columns from per-project dynamic
 * `ProjectStatus` rows (id/name/color/sort_order/hidden). The local board has
 * a CLOSED set of five task statuses, so columns are hardcoded here instead of
 * fetched. `color` is a raw HSL triple string ("H S% L%") consumed by the
 * header as `hsl(${color})`, matching the cloud `status.color` contract.
 */
export interface LocalKanbanColumn {
  /** Column / droppable id === the task status it represents. */
  id: LocalTaskStatus;
  name: string;
  /** Raw HSL value string, rendered via `hsl(${color})`. */
  color: string;
  /** 1-based render order, also used by the sort-order formula. */
  sort_order: number;
}

export const LOCAL_KANBAN_COLUMNS: readonly LocalKanbanColumn[] = [
  { id: 'todo', name: 'Todo', color: '215 16% 47%', sort_order: 1 },
  { id: 'inprogress', name: 'In Progress', color: '217 91% 60%', sort_order: 2 },
  { id: 'inreview', name: 'In Review', color: '38 92% 50%', sort_order: 3 },
  { id: 'done', name: 'Done', color: '142 71% 45%', sort_order: 4 },
  { id: 'cancelled', name: 'Cancelled', color: '0 72% 51%', sort_order: 5 },
] as const;

const VALID_STATUSES = new Set<LocalTaskStatus>(
  LOCAL_KANBAN_COLUMNS.map((c) => c.id)
);

/**
 * Map an arbitrary droppableId / task status onto a known column id.
 * Returns null when the id is not one of the five fixed columns (e.g. a stale
 * droppable), so callers can treat the drop as a no-op.
 */
export function statusToColumnId(status: string): LocalTaskStatus | null {
  return VALID_STATUSES.has(status as LocalTaskStatus)
    ? (status as LocalTaskStatus)
    : null;
}

/**
 * Short human-readable display id for a task, e.g. "T-1A2B3C4D".
 * The local Task has no `simple_id` / `issue_number`, so derive a stable label
 * from the UUID head. Purely presentational.
 */
export function taskDisplayId(task: LocalTask): string {
  const head = task.id.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `T-${head}`;
}

/**
 * Adapt a LocalTask into the `KanbanCardContent` prop contract.
 *
 * Cloud-only concepts are omitted gracefully:
 *   - priority      -> null   (no priority field on local Task)
 *   - tags          -> []     (no tags)
 *   - assignees     -> []     (no assignees)
 *   - pullRequests / relationships -> defaulted by the component
 *   - tagEditProps  -> undefined (read-only tags)
 *
 * `isSubIssue` reflects whether the task hangs off a parent workspace, which is
 * the closest local analogue to the cloud sub-issue indicator.
 */
export function taskToCardContent(task: LocalTask): KanbanCardContentProps {
  return {
    displayId: taskDisplayId(task),
    title: task.title,
    description: task.description ?? null,
    priority: null,
    tags: [],
    assignees: [],
    isSubIssue: Boolean(task.parent_workspace_id),
  };
}

/**
 * Group tasks into an ordered `Record<statusId, taskId[]>` map (the board's
 * `ItemsMap`). Within each column, tasks keep their incoming order (the API
 * returns them sorted by `created_at ASC`). Tasks whose status is not one of
 * the five fixed columns are dropped.
 */
export function buildItemsMap(
  tasks: LocalTask[]
): Record<LocalTaskStatus, string[]> {
  const map = {
    todo: [],
    inprogress: [],
    inreview: [],
    done: [],
    cancelled: [],
  } as Record<LocalTaskStatus, string[]>;

  for (const task of tasks) {
    const columnId = statusToColumnId(task.status);
    if (columnId) {
      map[columnId].push(task.id);
    }
  }

  return map;
}
