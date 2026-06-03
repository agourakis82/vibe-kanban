import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { handleApiResponse } from '@/shared/lib/api';
import { makeLocalApiRequest } from '@/shared/lib/localApiTransport';

/**
 * Local kanban task shape (fork addition).
 *
 * Mirrors the backend `db::models::task::Task` (serde `rename_all = "lowercase"`)
 * served by the local REST endpoints:
 *   GET   /api/projects/{project_id}/tasks  -> Task[]
 *   PATCH /api/tasks/{task_id}/status       -> Task   (body { status })
 *
 * Defined inline rather than imported from `shared/types` because the ts-rs
 * bindings for `Task` are generated from Rust and may not yet be present in the
 * committed `shared/types.ts`. Keeping this local makes the board drop-in.
 */
export type LocalTaskStatus =
  | 'todo'
  | 'inprogress'
  | 'inreview'
  | 'done'
  | 'cancelled';

export interface LocalTask {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  status: LocalTaskStatus;
  parent_workspace_id?: string | null;
  created_at: string;
  updated_at: string;
}

export const localProjectTaskKeys = {
  all: ['localProjectTasks'] as const,
  byProject: (projectId: string | undefined) =>
    ['localProjectTasks', projectId] as const,
};

type Options = {
  enabled?: boolean;
  refetchInterval?: number | false;
};

/**
 * Reactive list of all tasks for a project. Backs the local kanban board.
 */
export function useLocalProjectTasks(projectId?: string, opts?: Options) {
  const enabled = (opts?.enabled ?? true) && !!projectId;
  const refetchInterval = opts?.refetchInterval ?? 5000;

  return useQuery<LocalTask[]>({
    queryKey: localProjectTaskKeys.byProject(projectId),
    queryFn: async () => {
      const response = await makeLocalApiRequest(
        `/api/projects/${projectId}/tasks`
      );
      return handleApiResponse<LocalTask[]>(response);
    },
    enabled,
    refetchInterval,
  });
}

interface UpdateTaskStatusParams {
  taskId: string;
  status: LocalTaskStatus;
  /** Required to scope the optimistic cache update + invalidation. */
  projectId: string;
}

interface UpdateTaskStatusContext {
  previousTasks?: LocalTask[];
}

/**
 * Drag-drop write path: PATCH a single task's status with an optimistic cache
 * update + rollback-on-error, matching the pre-sunset board's behaviour of
 * applying the move immediately and reconciling on the server response.
 */
export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation<
    LocalTask,
    unknown,
    UpdateTaskStatusParams,
    UpdateTaskStatusContext
  >({
    mutationFn: async ({ taskId, status }: UpdateTaskStatusParams) => {
      const response = await makeLocalApiRequest(
        `/api/tasks/${taskId}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }
      );
      return handleApiResponse<LocalTask>(response);
    },
    onMutate: async ({ taskId, status, projectId }) => {
      const key = localProjectTaskKeys.byProject(projectId);
      // Stop in-flight refetches so they can't clobber the optimistic value.
      await queryClient.cancelQueries({ queryKey: key });

      const previousTasks = queryClient.getQueryData<LocalTask[]>(key);

      if (previousTasks) {
        queryClient.setQueryData<LocalTask[]>(
          key,
          previousTasks.map((task) =>
            task.id === taskId ? { ...task, status } : task
          )
        );
      }

      return { previousTasks };
    },
    onError: (err, variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(
          localProjectTaskKeys.byProject(variables.projectId),
          context.previousTasks
        );
      }
      console.error('Failed to update task status:', err);
    },
    onSettled: (_data, _err, variables) => {
      // Reconcile with server truth once the write resolves (success or error).
      queryClient.invalidateQueries({
        queryKey: localProjectTaskKeys.byProject(variables.projectId),
      });
    },
  });
}
