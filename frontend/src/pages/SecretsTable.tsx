import { useEffect, useState } from 'react';
import {
  listSecrets,
  createSecret,
  deleteSecret,
  type Secret,
} from '@/lib/secrets';
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

export function SecretsTable({ environmentId }: { environmentId: string }) {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setSecrets(await listSecrets(environmentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [environmentId]);

  async function handleAdd() {
    try {
      await createSecret(environmentId, newKey.trim(), newValue);
      setNewKey('');
      setNewValue('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteSecret(environmentId, id);
      await load();
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
        <Button onClick={handleAdd} disabled={!newKey.trim() || !newValue}>
          Add
        </Button>
      </div>

      {loading ? (
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
