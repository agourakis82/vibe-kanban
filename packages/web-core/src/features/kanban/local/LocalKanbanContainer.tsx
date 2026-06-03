import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
  type DropResult,
} from '@vibe/ui/components/KanbanBoard';
import { KanbanCardContent } from '@vibe/ui/components/KanbanCardContent';
import {
  useLocalProjectTasks,
  useUpdateTaskStatus,
  type LocalTask,
  type LocalTaskStatus,
} from '@/shared/hooks/useLocalProjectTasks';
import {
  LOCAL_KANBAN_COLUMNS,
  buildItemsMap,
  statusToColumnId,
  taskToCardContent,
} from './localKanbanModel';

type ItemsMap = Record<LocalTaskStatus, string[]>;

const EMPTY_ITEMS: ItemsMap = {
  todo: [],
  inprogress: [],
  inreview: [],
  done: [],
  cancelled: [],
};

export interface LocalKanbanContainerProps {
  projectId: string;
  projectName?: string;
}

/**
 * Fully-local kanban board, adapted from KanbanContainer @3733865e.
 *
 * Kept from the original:
 *   - the `KanbanProvider` / `KanbanBoard` / `KanbanCards` / `KanbanCard`
 *     column-render layout and the `@hello-pangea/dnd` `DropResult` wiring
 *   - the optimistic local `items` (ItemsMap) state + the drag-end splice logic
 *   - a lightweight filter UI (search box) in place of the cloud filter store
 *
 * Replaced from the original:
 *   - `useProjectContext()` / `useShape()` reads        -> `useLocalProjectTasks`
 *   - `bulkUpdateIssues(updates)` remote write           -> `useUpdateTaskStatus`
 *   - dynamic per-project `statuses`                     -> 5 fixed columns
 *
 * Deferred (cloud-only) and omitted gracefully: tags, assignees, priority,
 * issue_number/displayId-from-server, sub-issue trees, workspaces, multi-select,
 * list view, per-view preferences.
 */
export function LocalKanbanContainer({
  projectId,
  projectName,
}: LocalKanbanContainerProps) {
  const { data: tasks = [], isLoading } = useLocalProjectTasks(projectId);
  const updateTaskStatus = useUpdateTaskStatus();

  const [searchQuery, setSearchQuery] = useState('');

  // Local board state: statusId -> ordered taskId[]. Mirrors the original
  // `items` useState, rebuilt from server data whenever it changes.
  const [items, setItems] = useState<ItemsMap>(EMPTY_ITEMS);

  // During an optimistic drag we suppress the rebuild so the in-flight PATCH +
  // refetch can't cause the card to snap back (original `isSyncingRef`).
  const isSyncingRef = useRef(false);

  const tasksById = useMemo(() => {
    const map = new Map<string, LocalTask>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);

  // Pure local filter (replaces useKanbanFilters): title/description contains.
  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) => {
      const haystack = `${task.title} ${task.description ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [tasks, searchQuery]);

  // Rebuild the items map from filtered tasks + fixed columns (original lines
  // 484-531), unless a drag is currently syncing.
  useEffect(() => {
    if (isSyncingRef.current) return;
    setItems(buildItemsMap(filteredTasks));
  }, [filteredTasks]);

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;

    // Guard: dropped outside any column, or no movement (original step 1).
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }

    const sourceId = statusToColumnId(source.droppableId);
    const destId = statusToColumnId(destination.droppableId);
    if (!sourceId || !destId) return;

    // Optimistic local reorder (original step 3). Within-column reordering is
    // purely visual here (there is no persisted sort_order on the local Task),
    // so only a cross-column move triggers a write.
    setItems((prev) => {
      const next: ItemsMap = { ...prev };
      const sourceItems = [...next[sourceId]];
      const [moved] = sourceItems.splice(source.index, 1);
      if (moved == null) return prev;

      if (sourceId === destId) {
        sourceItems.splice(destination.index, 0, moved);
        next[sourceId] = sourceItems;
      } else {
        const destItems = [...next[destId]];
        destItems.splice(destination.index, 0, moved);
        next[sourceId] = sourceItems;
        next[destId] = destItems;
      }
      return next;
    });

    // Only a column change is a real status change to persist.
    if (sourceId === destId) return;

    isSyncingRef.current = true;
    updateTaskStatus
      .mutateAsync({ taskId: draggableId, status: destId, projectId })
      .catch(() => {
        // onError in the hook already rolled back the query cache; rebuild the
        // local items map from whatever the cache now holds on next effect run.
      })
      .finally(() => {
        // Match the original 500ms settle before re-enabling rebuilds.
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 500);
      });
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* Filter / view UI (local search replaces the cloud KanbanFilterBar). */}
      <div className="flex items-center gap-base p-base border-b shrink-0">
        {projectName ? (
          <span className="text-sm font-medium text-high">{projectName}</span>
        ) : null}
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tasks…"
          className="ml-auto h-8 rounded-md border bg-primary px-base text-sm outline-none focus:ring-2 focus:ring-accent"
          aria-label="Search tasks"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading && tasks.length === 0 ? (
          <div className="flex items-center justify-center h-full w-full">
            <p className="text-low">Loading…</p>
          </div>
        ) : (
          <KanbanProvider onDragEnd={handleDragEnd}>
            {LOCAL_KANBAN_COLUMNS.map((column) => {
              const taskIds = items[column.id] ?? [];
              return (
                <KanbanBoard key={column.id}>
                  <KanbanHeader>
                    <div className="flex items-center gap-half p-base sticky top-0 bg-primary z-10 border-b">
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: `hsl(${column.color})` }}
                        aria-hidden
                      />
                      <span className="text-sm font-medium text-high">
                        {column.name}
                      </span>
                      <span className="text-xs text-low ml-auto">
                        {taskIds.length}
                      </span>
                    </div>
                  </KanbanHeader>

                  <KanbanCards id={column.id}>
                    {taskIds.map((taskId, index) => {
                      const task = tasksById.get(taskId);
                      if (!task) return null;
                      return (
                        <KanbanCard
                          key={taskId}
                          id={taskId}
                          name={task.title}
                          index={index}
                          dragDisabled={updateTaskStatus.isPending}
                        >
                          <KanbanCardContent {...taskToCardContent(task)} />
                        </KanbanCard>
                      );
                    })}
                  </KanbanCards>
                </KanbanBoard>
              );
            })}
          </KanbanProvider>
        )}
      </div>
    </div>
  );
}
