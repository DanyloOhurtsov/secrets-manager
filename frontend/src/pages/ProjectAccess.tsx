import { useEffect, useState } from 'react';
import { transferProject } from '@/lib/projects';
import { listMyOrganizations, type Organization } from '@/lib/organizations';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const selectClass = 'border rounded-md h-9 px-3 text-sm bg-transparent';

// Перенесення проєкту між org — операція життєвого циклу проєкту, не RBAC.
// Грантами тепер керує вкладка Access на сторінці організації.
export function TransferProjectDialog({
  projectId,
  currentOrganizationId,
  onClose,
  onTransferred,
}: {
  projectId: string;
  currentOrganizationId?: string;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  useEffect(() => {
    listMyOrganizations()
      .then((all) =>
        setOrgs(
          all.filter(
            (o) =>
              o.id !== currentOrganizationId &&
              (o.role === 'owner' || o.role === 'admin'),
          ),
        ),
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      );
  }, [currentOrganizationId]);

  async function handleTransfer() {
    setError('');
    try {
      const res = await transferProject(projectId, target);
      setResult(
        `Transferred. ${res.revokedGrants} grant(s) revoked for non-members.`,
      );
      onTransferred();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer project</DialogTitle>
          <DialogDescription>
            You must be owner/admin in both the current and target organization.
            Grants for identities not in the target org are revoked.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {result ? (
          <p className="text-sm text-green-600">{result}</p>
        ) : (
          <select
            className={`${selectClass} w-full`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Select target organization…</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.type})
              </option>
            ))}
          </select>
        )}

        <DialogFooter>
          {!result && (
            <Button disabled={!target} onClick={handleTransfer}>
              Transfer
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {result ? 'Done' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
