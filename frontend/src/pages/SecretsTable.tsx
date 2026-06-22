import { useState } from 'react';
import { type Secret } from '@/lib/secrets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface SecretsTableProps {
  secrets: Secret[] | undefined; // undefined = ще не завантажено
  onAdd: (key: string, value: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function SecretsTable({ secrets, onAdd, onDelete }: SecretsTableProps) {
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    setError('');
    setBusy(true);
    try {
      await onAdd(newKey.trim(), newValue);
      setNewKey('');
      setNewValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setError('');
    try {
      await onDelete(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div>
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <div className="flex gap-2 mb-4">
        <Input
          placeholder="KEY"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="max-w-xs"
        />
        <Input
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
        />
        <Button onClick={handleAdd} disabled={busy || !newKey.trim() || !newValue}>
          Add
        </Button>
      </div>

      {secrets === undefined ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : secrets.length === 0 ? (
        <p className="text-muted-foreground">No secrets yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {secrets.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono">{s.key}</TableCell>
                <TableCell className="font-mono">
                  {revealed.has(s.id) ? s.value : '••••••••'}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleReveal(s.id)}
                  >
                    {revealed.has(s.id) ? 'Hide' : 'Show'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(s.id)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
