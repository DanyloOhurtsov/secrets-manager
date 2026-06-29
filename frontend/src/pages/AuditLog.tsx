import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  listAuditActions,
  listAuditLog,
  type AuditEntry,
} from '@/lib/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const actionGroupLabels: Record<string, string> = {
  auth: 'Auth',
  environment: 'Environments',
  grant: 'Access',
  identity: 'Access',
  key_rotation: 'System',
  project: 'Projects',
  secret: 'Secrets',
  token: 'Access',
};

function groupAuditActions(actions: string[]) {
  const groups = new Map<string, string[]>();

  for (const action of actions) {
    const key = action.startsWith('key_rotation')
      ? 'key_rotation'
      : action.split('.')[0];
    const label = actionGroupLabels[key] ?? 'Other';
    groups.set(label, [...(groups.get(label) ?? []), action]);
  }

  return [...groups.entries()].map(([label, groupActions]) => ({
    label,
    actions: groupActions,
  }));
}

function actionStyle(action: string): {
  variant: 'default' | 'secondary' | 'destructive';
} {
  if (action.includes('delete') || action.includes('revoke'))
    return { variant: 'destructive' };
  if (
    action.includes('create') ||
    action.includes('issue') ||
    action.includes('rotate')
  )
    return { variant: 'default' };
  return { variant: 'secondary' };
}

export function AuditLog({ organizationId }: { organizationId?: string } = {}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const availableActionSet = useMemo(
    () => new Set(availableActions),
    [availableActions],
  );
  const selectedAvailableActions = selectedActions.filter((action) =>
    availableActionSet.has(action),
  );
  const actionGroups = useMemo(
    () => groupAuditActions(availableActions),
    [availableActions],
  );
  const selectedSummary =
    availableActions.length === 0
      ? 'No events yet'
      : selectedAvailableActions.length === 0
        ? 'All events'
        : selectedAvailableActions.length <= 2
          ? selectedAvailableActions.join(', ')
          : `${selectedAvailableActions.length} events selected`;

  async function load(actions = selectedActions) {
    setLoading(true);
    setError('');
    Promise.all([
      listAuditActions({ organizationId }),
      listAuditLog({
        action: actions.length > 0 ? actions : undefined,
        organizationId,
      }),
    ])
      .then(([nextActions, nextEntries]) => {
        setAvailableActions([...nextActions].sort((a, b) => a.localeCompare(b)));
        setEntries(nextEntries);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }

  function toggleAction(action: string) {
    setSelectedActions((current) =>
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action],
    );
  }

  useEffect(() => {
    void load(selectedActions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedActions]);

  useEffect(() => {
    setSelectedActions((current) => {
      const next = current.filter((action) => availableActionSet.has(action));
      const unchanged =
        next.length === current.length &&
        next.every((action, index) => action === current[index]);

      return unchanged ? current : next;
    });
  }, [availableActionSet]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="relative flex flex-col gap-2 sm:w-96">
          <Label htmlFor="audit-action">Event</Label>
          <Button
            type="button"
            variant="outline"
            id="audit-action"
            className="w-full justify-between"
            onClick={() => setSelectorOpen((open) => !open)}
            disabled={loading || availableActions.length === 0}
          >
            <span className="truncate text-left">{selectedSummary}</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
          {selectorOpen && availableActions.length > 0 && (
            <div className="absolute top-full left-0 z-20 mt-1 w-full rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
              <div className="max-h-72 overflow-auto">
                {actionGroups.map((group) => (
                  <div key={group.label} className="py-1">
                    <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                      {group.label}
                    </div>
                    {group.actions.map((eventAction) => (
                      <label
                        key={eventAction}
                        className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          className="size-4 rounded border-input"
                          checked={selectedAvailableActions.includes(
                            eventAction,
                          )}
                          onChange={() => toggleAction(eventAction)}
                          disabled={loading}
                        />
                        <span className="truncate font-mono text-xs">
                          {eventAction}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <Button onClick={() => void load(selectedActions)} disabled={loading}>
          Refresh
        </Button>
        <Button
          variant="outline"
          onClick={() => setSelectedActions([])}
          disabled={loading || selectedActions.length === 0}
        >
          Clear
        </Button>
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="text-muted-foreground">No audit entries yet.</p>
      )}
      {!loading && !error && entries.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => {
              const { variant } = actionStyle(e.action);
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {e.actorName}
                  </TableCell>
                  <TableCell>
                    <Badge variant={variant}>{e.action}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    <div>{e.organizationName ?? e.organizationId ?? 'system'}</div>
                    {e.projectId && (
                      <div className="font-mono">project:{e.projectId.slice(0, 8)}</div>
                    )}
                    {e.environmentId && (
                      <div className="font-mono">
                        env:{e.environmentId.slice(0, 8)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.targetType}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground max-w-xs truncate">
                    {e.metadata ? JSON.stringify(e.metadata) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
