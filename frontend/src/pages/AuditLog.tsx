import { useEffect, useState } from 'react';
import { listAuditLog, type AuditEntry } from '@/lib/admin';
import { Badge } from '@/components/ui/badge';
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
  if (action.includes('create') || action.includes('issue') || action.includes('rotate'))
    return { variant: 'default' };
  return { variant: 'secondary' };
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listAuditLog()
      .then(setEntries)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (entries.length === 0)
    return <p className="text-muted-foreground">No audit entries yet.</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Who</TableHead>
          <TableHead>Action</TableHead>
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
  );
}
