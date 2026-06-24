import { useCallback, useEffect, useState } from 'react';
import {
  addMember,
  changeMemberRole,
  removeMember,
  type OrgDetail,
  type OrgMember,
} from '@/lib/organizations';
import {
  listServiceAccounts,
  type ServiceAccount,
} from '@/lib/service-accounts';
import { listEnvironments, type Environment } from '@/lib/projects';
import {
  listOrgGrants,
  createOrgGrant,
  updateOrgGrant,
  revokeOrgGrant,
  type OrgGrant,
} from '@/lib/grants';
import { ServiceAccountsTab } from './OrgTabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
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

const selectClass = 'border rounded-md h-9 px-3 text-sm bg-transparent';
const ROLES = ['viewer', 'reader', 'developer', 'admin'];

// Data-plane capability-прапорці, які можна вмикати на developer-гранті.
// "manage grants" сюди НАВМИСНО не входить: керування грантами — прерогатива
// org owner/admin, а не data-plane capability (інакше делегат міг би сам собі
// дописати reveal — H1). Тому його не показуємо як звичайний чекбокс.
type CapKey =
  | 'canRevealSecrets'
  | 'canCreateSecrets'
  | 'canUpdateSecrets'
  | 'canDeleteSecrets'
  | 'canRollbackSecrets';

const CAPS: { key: CapKey; label: string }[] = [
  { key: 'canRevealSecrets', label: 'reveal' },
  { key: 'canCreateSecrets', label: 'create' },
  { key: 'canUpdateSecrets', label: 'update' },
  { key: 'canDeleteSecrets', label: 'delete' },
  { key: 'canRollbackSecrets', label: 'rollback' },
];

const ROLE_HINTS: Record<string, string> = {
  viewer: 'Lists secret keys only — cannot reveal values.',
  reader: 'Can list and reveal secret values.',
  developer: 'No value access by default — enable capabilities explicitly.',
  admin: 'Full access to this scope (all capabilities).',
};

type Caps = Partial<Record<CapKey, boolean>>;

// Admin full capability
function capsPayload(role: string, caps: Caps): Caps {
  if (role === 'admin') return {};
  const out: Caps = {};
  for (const c of CAPS) out[c.key] = !!caps[c.key];
  return out;
}

function capsSummary(grant: OrgGrant): string {
  return CAPS.filter((c) => grant[c.key])
    .map((c) => c.label)
    .join(', ');
}

interface Candidate {
  id: string;
  label: string;
}

// Capability switch
function CapabilityFields({
  role,
  caps,
  setCaps,
}: {
  role: string;
  caps: Caps;
  setCaps: (next: Caps) => void;
}) {
  if (role === 'admin') return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {CAPS.map((c) => (
        <label key={c.key} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={!!caps[c.key]}
            onChange={(e) => setCaps({ ...caps, [c.key]: e.target.checked })}
          />
          {c.label}
        </label>
      ))}
    </div>
  );
}

// Вибір скоупів. «Весь проєкт» взаємовиключний з конкретними оточеннями
// (він і так їх покриває). Кожен відмічений скоуп стає окремим грантом.
interface ScopeSelection {
  wholeProject: boolean;
  envIds: string[];
}

const EMPTY_SCOPE: ScopeSelection = { wholeProject: true, envIds: [] };

// Перелік скоупів як значень environment для createOrgGrant
// (undefined = весь проєкт).
function scopeList(sel: ScopeSelection): (string | undefined)[] {
  return sel.wholeProject ? [undefined] : sel.envIds;
}

function hasScope(sel: ScopeSelection): boolean {
  return sel.wholeProject || sel.envIds.length > 0;
}

function ScopePicker({
  envs,
  value,
  onChange,
}: {
  envs: Environment[];
  value: ScopeSelection;
  onChange: (next: ScopeSelection) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={value.wholeProject}
          onChange={(e) =>
            onChange({
              wholeProject: e.target.checked,
              envIds: e.target.checked ? [] : value.envIds,
            })
          }
        />
        whole project
      </label>
      {envs.map((env) => (
        <label key={env.id} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={value.envIds.includes(env.id)}
            onChange={(e) =>
              onChange({
                wholeProject: false,
                envIds: e.target.checked
                  ? [...value.envIds, env.id]
                  : value.envIds.filter((id) => id !== env.id),
              })
            }
          />
          {env.name}
        </label>
      ))}
    </div>
  );
}

export function OrgAccess({
  org,
  isOwner,
  isAdmin,
  currentId,
  reload,
}: {
  org: OrgDetail;
  isOwner: boolean;
  isAdmin: boolean;
  currentId: string;
  reload: () => Promise<void>;
}) {
  const [grants, setGrants] = useState<OrgGrant[]>([]);
  const [serviceAccounts, setServiceAccounts] = useState<ServiceAccount[]>([]);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [editing, setEditing] = useState<OrgGrant | null>(null);
  const [revoking, setRevoking] = useState<OrgGrant | null>(null);

  const loadAccess = useCallback(async () => {
    setError('');
    try {
      const [g, sa] = await Promise.all([
        listOrgGrants(org.id),
        listServiceAccounts(org.id),
      ]);
      setGrants(g);
      setServiceAccounts(sa);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load access');
    }
  }, [org.id]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  // Кандидати для гранту: люди-члени + сервіс-акаунти цієї org.
  const candidates: Candidate[] = [
    ...org.members
      .filter((m) => m.type === 'human')
      .map((m) => ({ id: m.identityId, label: `${m.name} · member` })),
    ...serviceAccounts.map((s) => ({ id: s.id, label: `${s.name} · service` })),
  ];

  async function runMember(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  const isPersonal = org.type === 'personal';

  return (
    <div className="flex flex-col gap-8">
      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          Organization roles are management, not secret access.
        </span>{' '}
        Owners and admins manage members, projects, and grants — but reading or
        changing secret values always requires an explicit project or
        environment grant below.
      </div>

      {/* MEMBERS */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Members</h3>
            <p className="text-xs text-muted-foreground">
              People in this organization and their management role.
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              Add member
            </Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Org role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {org.members.map((m: OrgMember) => {
              const isSelf = m.identityId === currentId;
              const isOwnerRow = m.role === 'owner';
              return (
                <TableRow key={m.identityId}>
                  <TableCell className="font-medium">
                    {m.name}
                    {isSelf && (
                      <span className="text-muted-foreground"> (you)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.email ?? '—'}
                  </TableCell>
                  <TableCell>
                    {isOwner && !isOwnerRow && !isSelf && !isPersonal ? (
                      <select
                        className={selectClass}
                        value={m.role}
                        onChange={(e) =>
                          runMember(() =>
                            changeMemberRole(
                              org.id,
                              m.identityId,
                              e.target.value,
                            ),
                          )
                        }
                      >
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                      </select>
                    ) : (
                      <Badge variant="secondary">{m.role}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!isOwnerRow && (isAdmin || isSelf) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          runMember(() => removeMember(org.id, m.identityId))
                        }
                      >
                        {isSelf ? 'Leave' : 'Remove'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      {/* SERVICE ACCOUNTS */}
      <section>
        <div className="mb-3">
          <h3 className="text-sm font-semibold">Service accounts</h3>
          <p className="text-xs text-muted-foreground">
            Token-only machine identities pinned to this organization.
          </p>
        </div>
        <ServiceAccountsTab orgId={org.id} isAdmin={isAdmin} />
      </section>

      {/* GRANTS */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Project &amp; environment access</h3>
            <p className="text-xs text-muted-foreground">
              Data-plane grants. This is the only thing that gives access to
              secret values.
            </p>
          </div>
          {isAdmin && (
            <Button
              size="sm"
              disabled={org.projects.length === 0}
              onClick={() => {
                setEditing(null);
                setGrantOpen(true);
              }}
            >
              Grant access
            </Button>
          )}
        </div>

        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No grants yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Identity</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <span className="font-medium">{g.identity.name}</span>
                    <Badge variant="secondary" className="ml-2">
                      {g.identity.type}
                    </Badge>
                  </TableCell>
                  <TableCell>{g.projectName ?? g.projectId.slice(0, 8)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {g.scopeType === 'environment'
                      ? (g.environmentName ?? 'environment')
                      : 'whole project'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{g.role}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {g.role === 'admin' ? 'all' : capsSummary(g) || '—'}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {isAdmin && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(g);
                            setGrantOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevoking(g)}
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {addOpen && (
        <AddMemberDialog
          org={org}
          isOwner={isOwner}
          onClose={() => setAddOpen(false)}
          onDone={async () => {
            await reload();
            await loadAccess();
          }}
        />
      )}

      {grantOpen && (
        <GrantEditorDialog
          org={org}
          candidates={candidates}
          editing={editing}
          onClose={() => {
            setGrantOpen(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setGrantOpen(false);
            setEditing(null);
            await loadAccess();
          }}
        />
      )}

      <ConfirmDialog
        open={!!revoking}
        title="Revoke access?"
        description={
          revoking
            ? `Remove ${revoking.identity.name}'s ${revoking.role} access to ${
                revoking.projectName ?? 'this project'
              }${
                revoking.scopeType === 'environment' && revoking.environmentName
                  ? ` / ${revoking.environmentName}`
                  : ''
              }.`
            : ''
        }
        confirmLabel="Revoke"
        destructive
        onConfirm={() => {
          const g = revoking;
          setRevoking(null);
          if (g) void runRevoke(org.id, g.id, loadAccess, setError);
        }}
        onClose={() => setRevoking(null)}
      />
    </div>
  );
}

async function runRevoke(
  orgId: string,
  grantId: string,
  reload: () => Promise<void>,
  setError: (msg: string) => void,
) {
  try {
    await revokeOrgGrant(orgId, grantId);
    await reload();
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to revoke');
  }
}

// Чернетка одного гранту в add-member флоу.
interface GrantDraft {
  projectId: string;
  projectName: string;
  environment: string;
  environmentName: string;
  role: string;
  caps: Caps;
}

function AddMemberDialog({
  org,
  isOwner,
  onClose,
  onDone,
}: {
  org: OrgDetail;
  isOwner: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [drafts, setDrafts] = useState<GrantDraft[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Білдер чернеток доступу.
  const [projectId, setProjectId] = useState('');
  const [scope, setScope] = useState<ScopeSelection>(EMPTY_SCOPE);
  const [grantRole, setGrantRole] = useState('developer');
  const [caps, setCaps] = useState<Caps>({});
  const [envs, setEnvs] = useState<Environment[]>([]);

  const isPersonal = org.type === 'personal';

  useEffect(() => {
    setScope(EMPTY_SCOPE);
    if (!projectId) {
      setEnvs([]);
      return;
    }
    let cancelled = false;
    listEnvironments(projectId)
      .then((e) => !cancelled && setEnvs(e))
      .catch(() => !cancelled && setEnvs([]));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Кожен відмічений скоуп → окрема чернетка; дублікати в межах проєкту пропускаємо.
  function addDraft() {
    if (!projectId || !hasScope(scope)) return;
    const project = org.projects.find((p) => p.id === projectId);
    const existing = new Set(
      drafts.filter((d) => d.projectId === projectId).map((d) => d.environment),
    );
    const draftCaps = capsPayload(grantRole, caps);
    const fresh: GrantDraft[] = scopeList(scope)
      .map((envId) => envId ?? '')
      .filter((envKey) => !existing.has(envKey))
      .map((envKey) => ({
        projectId,
        projectName: project?.name ?? projectId,
        environment: envKey,
        environmentName: envs.find((e) => e.id === envKey)?.name ?? '',
        role: grantRole,
        caps: draftCaps,
      }));
    setDrafts((prev) => [...prev, ...fresh]);
    setProjectId('');
    setScope(EMPTY_SCOPE);
    setGrantRole('developer');
    setCaps({});
  }

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const member = await addMember(org.id, email.trim(), role);
      for (const d of drafts) {
        await createOrgGrant(org.id, {
          identityId: member.identityId,
          projectId: d.projectId,
          environment: d.environment || undefined,
          role: d.role,
          ...d.caps,
        });
      }
      await onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Add an existing account by email and optionally grant initial
            project access in the same step.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Member email</Label>
            <Input
              placeholder="person@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-64"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Org role</Label>
            <select
              className={selectClass}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="member">member</option>
              {isOwner && !isPersonal && <option value="admin">admin</option>}
            </select>
          </div>
        </div>

        <div className="rounded-md border p-3">
          <p className="mb-2 text-xs font-medium">
            Initial project access (optional)
          </p>

          {drafts.length > 0 && (
            <div className="mb-3 flex flex-col gap-1">
              {drafts.map((d, i) => (
                <div
                  key={`${d.projectId}-${d.environment}-${i}`}
                  className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-sm"
                >
                  <span>
                    <span className="font-medium">{d.projectName}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      / {d.environmentName || 'whole project'} · {d.role}
                      {d.role !== 'admin' &&
                        Object.values(d.caps).some(Boolean) &&
                        ` · ${CAPS.filter((c) => d.caps[c.key])
                          .map((c) => c.label)
                          .join(', ')}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setDrafts((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {org.projects.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No projects in this organization yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Project</Label>
                  <select
                    className={`${selectClass} min-w-48`}
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {org.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Role</Label>
                  <select
                    className={selectClass}
                    value={grantRole}
                    onChange={(e) => setGrantRole(e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Scopes</Label>
                {projectId ? (
                  <ScopePicker envs={envs} value={scope} onChange={setScope} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Select a project first.
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {ROLE_HINTS[grantRole]}
              </p>
              <CapabilityFields role={grantRole} caps={caps} setCaps={setCaps} />
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!projectId || !hasScope(scope)}
                  onClick={addDraft}
                >
                  Add access
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!email.trim() || busy} onClick={submit}>
            {busy ? 'Adding…' : 'Add member'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantEditorDialog({
  org,
  candidates,
  editing,
  onClose,
  onSaved,
}: {
  org: OrgDetail;
  candidates: Candidate[];
  editing: OrgGrant | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [identityId, setIdentityId] = useState(editing?.identityId ?? '');
  const [projectId, setProjectId] = useState(editing?.projectId ?? '');
  // Скоуп — мультивибір в обох режимах. У редагуванні передвибираємо поточний
  // скоуп гранту; додаткові відмічені оточення стають новими грантами (additive),
  // решта рядків цього актора лишаються недоторканими.
  const [scope, setScope] = useState<ScopeSelection>(() => {
    if (!editing) return EMPTY_SCOPE;
    return editing.scopeType === 'environment'
      ? { wholeProject: false, envIds: [editing.scopeId] }
      : { wholeProject: true, envIds: [] };
  });
  const [role, setRole] = useState(editing?.role ?? 'developer');
  const [caps, setCaps] = useState<Caps>(() => {
    if (!editing) return {};
    const c: Caps = {};
    for (const cap of CAPS) c[cap.key] = editing[cap.key];
    return c;
  });
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const locked = !!editing;

  // Оточення вантажимо і в режимі редагування — скоуп тепер можна змінювати
  // (весь проєкт ↔ конкретне середовище), тому потрібен їх список.
  useEffect(() => {
    if (!projectId) {
      setEnvs([]);
      return;
    }
    let cancelled = false;
    listEnvironments(projectId)
      .then((e) => !cancelled && setEnvs(e))
      .catch(() => !cancelled && setEnvs([]));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // '' = весь проєкт; інакше id оточення.
  const scopeLabel = (key: string) =>
    key ? (envs.find((e) => e.id === key)?.name ?? key) : 'whole project';

  async function submit() {
    setError('');
    setBusy(true);
    const caps_ = capsPayload(role, caps);
    // Ключі відмічених скоупів ('' = весь проєкт). hasScope гарантує ≥1.
    const selectedKeys = scopeList(scope).map((s) => s ?? '');
    const failures: string[] = [];

    if (editing) {
      // Один наявний грант оновлюємо «на місці» (зберігаючи його id), решту
      // відмічених скоупів додаємо як нові гранти. Інші рядки актора не чіпаємо.
      const originalKey =
        editing.scopeType === 'environment' ? editing.scopeId : '';
      const keepKey = selectedKeys.includes(originalKey)
        ? originalKey
        : selectedKeys[0];
      const addKeys = selectedKeys.filter((k) => k !== keepKey);

      try {
        await updateOrgGrant(org.id, editing.id, {
          role,
          environment: keepKey,
          ...caps_,
        });
      } catch (err) {
        failures.push(
          `${scopeLabel(keepKey)}: ${err instanceof Error ? err.message : 'failed'}`,
        );
      }
      for (const key of addKeys) {
        try {
          await createOrgGrant(org.id, {
            identityId: editing.identityId,
            projectId: editing.projectId,
            environment: key || undefined,
            role,
            ...caps_,
          });
        } catch (err) {
          failures.push(
            `${scopeLabel(key)}: ${err instanceof Error ? err.message : 'failed'}`,
          );
        }
      }
    } else {
      // Create: один грант на кожен відмічений скоуп; збираємо часткові помилки,
      // щоб конфлікт по одному скоупу не приховував успішно створені.
      for (const key of selectedKeys) {
        try {
          await createOrgGrant(org.id, {
            identityId,
            projectId,
            environment: key || undefined,
            role,
            ...caps_,
          });
        } catch (err) {
          failures.push(
            `${scopeLabel(key)}: ${err instanceof Error ? err.message : 'failed'}`,
          );
        }
      }
    }

    if (failures.length) {
      setError(`Could not save some scopes — ${failures.join('; ')}`);
      setBusy(false);
      return;
    }
    await onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit access' : 'Grant access'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Change the scopes, role and capabilities. Extra environments you tick are added as new grants; other rows for this identity are left untouched. To move it to a different project, revoke and re-grant.'
              : 'Give a member or service account access to a project or specific environments — pick several scopes to grant them at once.'}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {locked ? (
          <div className="flex flex-col gap-2">
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <span className="font-medium">{editing.identity.name}</span>
              <span className="text-muted-foreground">
                {' '}
                · {editing.projectName ?? editing.projectId.slice(0, 8)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Scopes</Label>
              <ScopePicker envs={envs} value={scope} onChange={setScope} />
              <p className="text-xs text-muted-foreground">
                This grant updates in place; tick extra environments to add them
                as new grants at the role and capabilities below.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Identity</Label>
                <select
                  className={`${selectClass} min-w-56`}
                  value={identityId}
                  onChange={(e) => setIdentityId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Project</Label>
                <select
                  className={`${selectClass} min-w-44`}
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {org.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Scopes</Label>
              {projectId ? (
                <ScopePicker envs={envs} value={scope} onChange={setScope} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Select a project first.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Tick whole project or one or more environments — each becomes
                its own grant.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Role</Label>
            <select
              className={selectClass}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              {ROLE_HINTS[role]}
            </span>
          </div>
          <CapabilityFields role={role} caps={caps} setCaps={setCaps} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              !hasScope(scope) ||
              (!editing && (!identityId || !projectId))
            }
            onClick={submit}
          >
            {editing ? 'Save' : 'Grant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
