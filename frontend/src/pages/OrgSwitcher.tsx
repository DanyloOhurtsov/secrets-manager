import { useCallback, useEffect, useState } from 'react';
import { useRouter, segments } from '@/lib/router';
import {
  listMyOrganizations,
  createOrganization,
  type Organization,
} from '@/lib/organizations';
import { setActiveOrg } from '@/lib/account';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const selectClass =
  'border rounded-md h-9 px-3 text-sm bg-transparent max-w-56 font-medium';

export function OrgSwitcher({ currentOrgId }: { currentOrgId: string | null }) {
  const { navigate, path } = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setOrgs(await listMyOrganizations());
    } catch {
      // мовчки — перемикач не критичний для рендеру сторінки
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function switchTo(id: string) {
    if (!id || id === currentOrgId) return;
    try {
      await setActiveOrg(id);
    } catch {
      // навіть якщо не збереглось — все одно переходимо
    }
    // Зберігаємо поточну вкладку при перемиканні воркспейсів
    // (projectId відкидаємо — він належить попередній org).
    const tab = segments(path)[2] ?? 'projects';
    navigate(`/orgs/${id}/${tab}`);
  }

  async function createTeam() {
    setError('');
    try {
      const org = await createOrganization(name.trim());
      setName('');
      setOpen(false);
      await load();
      await setActiveOrg(org.id).catch(() => undefined);
      navigate(`/orgs/${org.id}/projects`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className={selectClass}
        value={currentOrgId ?? ''}
        onChange={(e) => switchTo(e.target.value)}
        aria-label="Switch workspace"
      >
        {!currentOrgId && <option value="">Select workspace…</option>}
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            + Team
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create team organization</DialogTitle>
          </DialogHeader>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="teamname">Name</Label>
            <Input
              id="teamname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && createTeam()}
              placeholder="Acme Inc"
            />
          </div>
          <DialogFooter>
            <Button onClick={createTeam} disabled={!name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
