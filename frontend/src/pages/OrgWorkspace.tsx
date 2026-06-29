import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from '@/lib/router';
import { getOrganization, type OrgDetail } from '@/lib/organizations';
import { createProject } from '@/lib/projects';
import { SettingsTab } from './OrgTabs';
import { OrgAccess } from './OrgAccess';
import { ProjectDetail } from './ProjectDetail';
import { TransferProjectDialog } from './ProjectAccess';
import { AuditLog } from './AuditLog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

// Access та Audit показуємо лише owner/admin (бекенд однаково віддасть org-grants
// та org-audit тільки їм).
function tabsFor(isAdmin: boolean) {
  return [
    { key: 'overview', label: 'Overview' },
    { key: 'projects', label: 'Projects' },
    ...(isAdmin
      ? [
          { key: 'access', label: 'Access' },
          { key: 'audit', label: 'Audit' },
        ]
      : []),
  ];
}

export function OrgWorkspace({
  orgId,
  tab,
  projectId,
}: {
  orgId: string;
  tab: string;
  projectId?: string;
}) {
  const { identity } = useAuth();
  const { navigate } = useRouter();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setOrg(await getOrganization(orgId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!org) return <p className="text-muted-foreground">Loading...</p>;

  const isOwner = org.myRole === 'owner';
  const isAdmin = isOwner || org.myRole === 'admin';
  // Недоступну вкладку (напр. access/audit для не-адміна) зводимо до overview.
  const tabs = tabsFor(isAdmin);
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'overview';

  // Деталі проєкту живуть усередині воркспейсу (перемикач/контекст org лишаються).
  if (tab === 'projects' && projectId) {
    const found = org.projects.find((p) => p.id === projectId);
    const project = {
      id: projectId,
      name: found?.name ?? 'Project',
      organizationId: orgId,
      createdAt: found?.createdAt ?? '',
    };
    return (
      <ProjectDetail
        key={projectId}
        project={project}
        onBack={() => navigate(`/orgs/${orgId}/projects`)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-xl font-semibold">{org.name}</h2>
        <Badge variant="secondary">{org.type}</Badge>
        <Badge>{org.myRole}</Badge>
        {org.status !== 'active' && (
          <Badge variant="secondary">{org.status}</Badge>
        )}
      </div>

      <div className="flex gap-1 border-b mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => navigate(`/orgs/${orgId}/${t.key}`)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? 'border-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <OrgOverview
          org={org}
          isOwner={isOwner}
          reload={load}
          onDeleted={() => navigate('/')}
        />
      )}
      {activeTab === 'projects' && (
        <OrgProjects
          org={org}
          isAdmin={isAdmin}
          reload={load}
          onOpen={(pid) => navigate(`/orgs/${orgId}/projects/${pid}`)}
        />
      )}
      {activeTab === 'access' && isAdmin && (
        <OrgAccess
          org={org}
          isOwner={isOwner}
          isAdmin={isAdmin}
          currentId={identity?.id ?? ''}
          reload={load}
        />
      )}
      {activeTab === 'audit' && isAdmin && <AuditLog organizationId={orgId} />}
    </div>
  );
}

function OrgOverview({
  org,
  isOwner,
  reload,
  onDeleted,
}: {
  org: OrgDetail;
  isOwner: boolean;
  reload: () => Promise<void>;
  onDeleted: () => void;
}) {
  const stats = [
    { label: 'Projects', value: org.projects.length },
    { label: 'Members', value: org.members.length },
  ];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="min-w-32">
            <CardContent className="py-4">
              <div className="text-2xl font-semibold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <SettingsTab
        org={org}
        isOwner={isOwner}
        reload={reload}
        onDeleted={onDeleted}
      />
    </div>
  );
}

function OrgProjects({
  org,
  isAdmin,
  reload,
  onOpen,
}: {
  org: OrgDetail;
  isAdmin: boolean;
  reload: () => Promise<void>;
  onOpen: (projectId: string) => void;
}) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [transferId, setTransferId] = useState<string | null>(null);

  async function create() {
    setError('');
    try {
      await createProject(name.trim(), org.id);
      setName('');
      setOpen(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {org.projects.length} project{org.projects.length === 1 ? '' : 's'}
        </p>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>New project</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create project in {org.name}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pname">Name</Label>
                <Input
                  id="pname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && name.trim() && create()
                  }
                  placeholder="api-gateway"
                />
              </div>
              <DialogFooter>
                <Button onClick={create} disabled={!name.trim()}>
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      {org.projects.length === 0 ? (
        <p className="text-muted-foreground">No projects yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {org.projects.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => onOpen(p.id)}
            >
              <CardContent className="flex items-center justify-between py-4">
                <span className="font-medium">{p.name}</span>
                <span className="flex items-center gap-3">
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTransferId(p.id);
                      }}
                    >
                      Transfer
                    </Button>
                  )}
                  <span className="text-sm text-muted-foreground">open →</span>
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {transferId && (
        <TransferProjectDialog
          projectId={transferId}
          currentOrganizationId={org.id}
          onClose={() => setTransferId(null)}
          onTransferred={() => {
            setTransferId(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
