import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  listMyTokens,
  createMyToken,
  revokeMyToken,
  type PersonalToken,
} from '@/lib/account';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AccountSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountSettings({ open, onOpenChange }: AccountSettingsProps) {
  const { identity } = useAuth();
  const [tokens, setTokens] = useState<PersonalToken[]>([]);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);

  async function load() {
    setError('');
    try {
      setTokens(await listMyTokens());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  // Тягнемо токени при кожному відкритті; скидаємо стан при закритті.
  useEffect(() => {
    if (open) {
      void load();
    } else {
      setNewToken(null);
      setError('');
      setLabel('');
      setExpiresInDays('');
    }
  }, [open]);

  async function handleIssue() {
    setError('');
    try {
      const days = expiresInDays.trim() ? Number(expiresInDays) : undefined;
      const res = await createMyToken(label.trim() || undefined, days);
      setNewToken(res.token);
      setLabel('');
      setExpiresInDays('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue');
    }
  }

  async function handleRevoke(id: string) {
    setError('');
    try {
      await revokeMyToken(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>
            {identity?.name} — personal API / CLI tokens
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {newToken && (
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="mb-2 text-sm font-medium">
              Token created — copy it now, it won't be shown again.
            </p>
            <code className="block break-all rounded bg-muted p-3 text-sm">
              {newToken}
            </code>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (newToken) void navigator.clipboard.writeText(newToken);
                }}
              >
                Copy
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNewToken(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Label</Label>
            <Input
              placeholder="laptop / cli"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="min-w-48"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Expires in (days, optional)</Label>
            <Input
              type="number"
              min={1}
              placeholder="never"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="max-w-40"
            />
          </div>
          <Button onClick={handleIssue}>Create token</Button>
        </div>

        {tokens.length === 0 ? (
          <p className="text-muted-foreground">No personal tokens.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.label ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.expiresAt
                      ? new Date(t.expiresAt).toLocaleDateString()
                      : 'never'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.lastUsedAt
                      ? new Date(t.lastUsedAt).toLocaleDateString()
                      : 'never'}
                  </TableCell>
                  <TableCell>
                    {t.revokedAt ? (
                      <Badge variant="secondary">revoked</Badge>
                    ) : (
                      <Badge>active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!t.revokedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(t.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
