import { useEffect, useState } from 'react';
import { listAuditLog, type AuditEntry } from '@/lib/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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

  async function load() {
    setLoading(true);
    setError('');
    listAuditLog({ action: action.trim() || undefined })
      .then(setEntries)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-2 sm:w-80">
          <Label htmlFor="audit-action">Event</Label>
          <Input
            id="audit-action"
            placeholder="secret.create / auth.signup / ..."
            value={action}
            onChange={(e) => setAction(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
          />
        </div>
        <Button onClick={() => void load()} disabled={loading}>
          Filter
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setAction('');
            setLoading(true);
            listAuditLog()
              .then(setEntries)
              .catch((err) =>
                setError(err instanceof Error ? err.message : 'Failed to load'),
              )
              .finally(() => setLoading(false));
          }}
          disabled={loading}
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
