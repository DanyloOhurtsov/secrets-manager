import { useEffect, useState } from 'react';
import {
  type Secret,
  type SecretVersion,
  type EnvironmentCapabilities,
} from '@/lib/secrets';
import { notifyError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SecretsTableProps {
  secrets: Secret[] | undefined;
  capabilities: EnvironmentCapabilities | undefined;
  onAdd: (key: string, value: string) => Promise<void>;
  onUpdate: (id: string, value: string) => Promise<void>;
  onRollback: (id: string, toVersion: number) => Promise<void>;
  onLoadVersions: (id: string) => Promise<SecretVersion[]>;
  onReveal: (id: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<void>;
}

export function SecretsTable({
  secrets,
  capabilities,
  onAdd,
  onUpdate,
  onRollback,
  onLoadVersions,
  onReveal,
  onDelete,
}: SecretsTableProps) {
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Secret | null>(null);
  const [history, setHistory] = useState<Secret | null>(null);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      notifyError(err);
    }
  }

  async function handleAdd() {
    setBusy(true);
    await run(async () => {
      await onAdd(newKey.trim(), newValue);
      setNewKey('');
      setNewValue('');
    });
    setBusy(false);
  }

  async function toggleReveal(id: string) {
    if (revealed[id] !== undefined) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    await run(async () => {
      const value = await onReveal(id);
      setRevealed((prev) => ({ ...prev, [id]: value ?? '' }));
    });
  }

  function clearRevealed(id: string) {
    setRevealed((prev) => {
      if (prev[id] === undefined) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  return (
    <div>
      {capabilities?.canCreate && (
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
          <Button
            onClick={handleAdd}
            disabled={busy || !newKey.trim() || !newValue}
          >
            Add
          </Button>
        </div>
      )}

      {secrets === undefined ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : secrets.length === 0 ? (
        <p className="text-muted-foreground">No secrets yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="w-16">Ver</TableHead>
              <TableHead className="w-px text-right whitespace-nowrap">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {secrets.map((s) => {
              const isRevealed = revealed[s.id] !== undefined;
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-mono">{s.key}</TableCell>
                  <TableCell
                    className="font-mono max-w-65 truncate"
                    title={isRevealed ? revealed[s.id] : undefined}
                  >
                    {!s.canReveal
                      ? '••••••••'
                      : isRevealed
                        ? revealed[s.id]
                        : '••••••••'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.currentVersion ?? '—'}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {s.canReveal && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void toggleReveal(s.id)}
                      >
                        {isRevealed ? 'Hide' : 'Show'}
                      </Button>
                    )}
                    {capabilities?.canUpdate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(s)}
                      >
                        Edit
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setHistory(s)}
                    >
                      History
                    </Button>
                    {capabilities?.canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => run(() => onDelete(s.id))}
                      >
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <EditSecretDialog
          secret={editing}
          onClose={() => setEditing(null)}
          onSave={(value) =>
            run(async () => {
              await onUpdate(editing.id, value);
              clearRevealed(editing.id);
              setEditing(null);
            })
          }
        />
      )}

      {history && (
        <HistoryDialog
          secret={history}
          canRollback={!!capabilities?.canRollback}
          loadVersions={onLoadVersions}
          onRollback={(version) =>
            run(async () => {
              await onRollback(history.id, version);
              clearRevealed(history.id);
              setHistory(null);
            })
          }
          onClose={() => setHistory(null)}
        />
      )}
    </div>
  );
}

function EditSecretDialog({
  secret,
  onSave,
  onClose,
}: {
  secret: Secret;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono">{secret.key}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Saving creates a new version (current: v{secret.currentVersion ?? '—'}
          ).
        </p>
        <Input
          autoFocus
          placeholder="new value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <DialogFooter>
          <Button disabled={!value} onClick={() => onSave(value)}>
            Save new version
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  secret,
  canRollback,
  loadVersions,
  onRollback,
  onClose,
}: {
  secret: Secret;
  canRollback: boolean;
  loadVersions: (id: string) => Promise<SecretVersion[]>;
  onRollback: (version: number) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<SecretVersion[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadVersions(secret.id)
      .then(setVersions)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      );
  }, [secret.id, loadVersions]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono">
            {secret.key} — history
          </DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {versions === null ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    v{v.version}{' '}
                    {v.isCurrent && <Badge>current</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {canRollback && !v.isCurrent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRollback(v.version)}
                      >
                        Rollback
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
