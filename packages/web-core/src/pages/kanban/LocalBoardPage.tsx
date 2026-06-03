import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import { LocalKanbanContainer } from '@/features/kanban/local/LocalKanbanContainer';

/**
 * Page-level wrapper for the fully-local kanban board.
 *
 * Resolves `projectId` from the route (same source the cloud ProjectKanban
 * used) and hands it to `LocalKanbanContainer`, which drives everything off the
 * local REST endpoints. No auth / org / ElectricSQL dependencies.
 *
 * Rendered inside SharedAppLayout (which provides Navbar/AppBar), same as the
 * cloud page it replaces.
 */
export function LocalBoardPage() {
  const { projectId } = useCurrentKanbanRouteState();

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <p className="text-low">No project selected.</p>
      </div>
    );
  }

  return <LocalKanbanContainer projectId={projectId} />;
}
