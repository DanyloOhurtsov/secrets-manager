import { useEffect, useState } from 'react';
import { listAuditLog, type AuditEntry } from '@/lib/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const auditActionGroups = [
  {
    label: 'Auth',
    actions: ['auth.signup', 'auth.login'],
  },
  {
    label: 'Projects',
    actions: ['project.create', 'project.delete'],
  },
  {
    label: 'Environments',
    actions: ['environment.create', 'environment.delete'],
  },
  {
    label: 'Secrets',
    actions: ['secret.create', 'secret.list', 'secret.reveal', 'secret.delete'],
  },
  {
    label: 'Access',
    actions: [
      'identity.create',
      'token.issue',
      'token.revoke',
      'grant.create',
      'grant.revoke',
    ],
  },
  {
    label: 'System',
    actions: ['key_rotation.complete'],
  },
];

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

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState('');

  async function load(selectedAction = action) {
    setLoading(true);
    setError('');
    listAuditLog({ action: selectedAction || undefined })
      .then(setEntries)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void load(action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-2 sm:w-80">
          <Label htmlFor="audit-action">Event</Label>
          <Select
            id="audit-action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            disabled={loading}
          >
            <option value="">All events</option>
            {auditActionGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.actions.map((eventAction) => (
                  <option key={eventAction} value={eventAction}>
                    {eventAction}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <Button onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
        <Button
          variant="outline"
          onClick={() => setAction('')}
          disabled={loading || action === ''}
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
