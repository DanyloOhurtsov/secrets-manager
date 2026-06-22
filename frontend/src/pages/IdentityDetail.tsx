import { useEffect, useState } from 'react';
import {
  listTokens,
  issueToken,
  revokeToken,
  listGrants,
  createGrant,
  revokeGrant,
  type Identity,
  type Token,
  type Grant,
} from '@/lib/admin';
import { useProjects } from '@/lib/projects-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function IdentityDetail({
  identity,
  onBack,
}: {
  identity: Identity;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <h2 className="text-xl font-semibold">{identity.name}</h2>
        <Badge variant="secondary">{identity.type}</Badge>
        {identity.isSuperadmin && <Badge>superadmin</Badge>}
      </div>

      <Tabs defaultValue="tokens">
        <TabsList className="mb-4">
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
          <TabsTrigger value="grants">Grants</TabsTrigger>
        </TabsList>
        <TabsContent value="tokens">
          <TokensTab identityId={identity.id} />
        </TabsContent>
        <TabsContent value="grants">
          <GrantsTab identityId={identity.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Tokens ---
function TokensTab({ identityId }: { identityId: string }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);

  async function load() {
    setError('');
    try {
      setTokens(await listTokens(identityId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityId]);

  async function handleIssue() {
    try {
      const res = await issueToken(identityId, label.trim() || undefined);
      setNewToken(res.token);
      setLabel('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue');
    }
  }

  async function handleRevoke(id: string) {
    try {
      await revokeToken(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke');
    }
  }

  return (
    <div>
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <div className="flex gap-2 mb-4">
        <Input
          placeholder="label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="max-w-xs"
        />
        <Button onClick={handleIssue}>Issue token</Button>
      </div>

      {tokens.length === 0 ? (
        <p className="text-muted-foreground">No tokens.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Created</TableHead>
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

      <Dialog open={!!newToken} onOpenChange={(o) => !o && setNewToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token issued</DialogTitle>
            <DialogDescription>
              Copy it now — it won't be shown again.
            </DialogDescription>
          </DialogHeader>
          <code className="block bg-muted p-3 rounded text-sm break-all">
            {newToken}
          </code>
          <DialogFooter>
            <Button
              onClick={() => {
                if (newToken) void navigator.clipboard.writeText(newToken);
              }}
            >
              Copy
            </Button>
            <Button variant="outline" onClick={() => setNewToken(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Grants ---
function GrantsTab({ identityId }: { identityId: string }) {
  const { projects } = useProjects();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState('');

  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState('readonly');
  const [environment, setEnvironment] = useState('');

  async function loadGrants() {
    setError('');
    try {
      setGrants(await listGrants(identityId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void loadGrants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityId]);

  // Виставляємо дефолтний проєкт коли список з'явився.
  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  async function handleCreate() {
    try {
      await createGrant(
        identityId,
        projectId,
        role,
        environment.trim() || undefined,
      );
      setEnvironment('');
      await loadGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    }
  }

  async function handleRevoke(id: string) {
    try {
      await revokeGrant(id);
      await loadGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke');
    }
  }

  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  return (
    <div>
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Project</Label>
          <select
            className="border rounded-md h-9 px-3 text-sm bg-transparent min-w-40"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Role</Label>
          <select
            className="border rounded-md h-9 px-3 text-sm bg-transparent"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="readonly">readonly</option>
            <option value="developer">developer</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Environment (optional)</Label>
          <Input
            placeholder="all"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            className="max-w-32"
          />
        </div>
        <Button onClick={handleCreate} disabled={!projectId}>
          Grant
        </Button>
      </div>

      {grants.length === 0 ? (
        <p className="text-muted-foreground">No grants.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((g) => (
              <TableRow key={g.id}>
                <TableCell>{projectName(g.projectId)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {g.environment ?? 'all'}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{g.role}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(g.id)}
                  >
                    Revoke
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
