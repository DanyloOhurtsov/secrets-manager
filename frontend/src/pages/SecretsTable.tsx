import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  History as HistoryIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  type Secret,
  type SecretVersion,
  type EnvironmentCapabilities,
} from '@/lib/secrets';
import { notifyError } from '@/lib/errors';
import { cn } from '@/lib/utils';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
          <Table className="w-full table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[20rem]">Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="w-12 text-center">Ver</TableHead>
              <TableHead className="w-12 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {secrets.map((s) => {
              const isRevealed = revealed[s.id] !== undefined;
              return (
                <TableRow key={s.id} className="group">
                  <TableCell className="overflow-hidden font-mono">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 truncate" title={s.key}>
                        {s.key}
                      </span>
                      <CopyKeyButton secretKey={s.key} />
                    </div>
                  </TableCell>
                  <TableCell className="overflow-hidden font-mono">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                      <span
                        className="truncate"
                        title={isRevealed ? revealed[s.id] : undefined}
                      >
                        {!s.canReveal
                          ? '••••••••'
                          : isRevealed
                            ? revealed[s.id]
                            : '••••••••'}
                      </span>
                      {s.canReveal && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={
                            isRevealed
                              ? `Hide value of ${s.key}`
                              : `Show value of ${s.key}`
                          }
                          title={isRevealed ? 'Hide secret value' : 'Show secret value'}
                          className="text-muted-foreground"
                          onClick={() => void toggleReveal(s.id)}
                        >
                          {isRevealed ? <EyeOff /> : <Eye />}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="w-12 text-center text-muted-foreground">
                    {s.currentVersion ?? '—'}
                  </TableCell>
                  <TableCell className="w-12 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${s.key}`}
                          title="Secret actions"
                          className="text-muted-foreground"
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {capabilities?.canUpdate && (
                          <DropdownMenuItem onSelect={() => setEditing(s)}>
                            <Pencil />
                            Edit
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => setHistory(s)}>
                          <HistoryIcon />
                          History
                        </DropdownMenuItem>
                        {capabilities?.canDelete && (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => void run(() => onDelete(s.id))}
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
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

// Кнопка-іконка для копіювання лише назви секрету (без значення).
function CopyKeyButton({ secretKey }: { secretKey: string }) {
  const [copied, setCopied] = useState(false);

  // Повертаємо іконку назад до Copy за мить після успіху.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secretKey);
      setCopied(true);
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Copy key ${secretKey}`}
      title="Copy secret key"
      onClick={() => void copy()}
      className={cn(
        'text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100',
        copied && 'opacity-100',
      )}
    >
      {copied ? (
        <Check className="text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy />
      )}
    </Button>
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
