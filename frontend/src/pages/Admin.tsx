import { useEffect, useState } from 'react';
import {
  listPlatformOrganizations,
  suspendOrganization,
  unsuspendOrganization,
  getHealth,
  rotateKeys,
  type PlatformOrganization,
  type Health,
} from '@/lib/admin';
import { AuditLog } from './AuditLog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function Admin({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <h2 className="text-xl font-semibold">Platform Administration</h2>
      </div>

      <Tabs defaultValue="organizations">
        <TabsList className="mb-4">
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="audit">Global Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="organizations">
          <PlatformOrganizations />
        </TabsContent>
        <TabsContent value="system">
          <SystemTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PlatformOrganizations() {
  const [orgs, setOrgs] = useState<PlatformOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setOrgs(await listPlatformOrganizations());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(org: PlatformOrganization) {
    setError('');
    try {
      if (org.status === 'suspended') {
        await unsuspendOrganization(org.id);
      } else {
        await suspendOrganization(org.id);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div>
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
      <p className="text-sm text-muted-foreground mb-4">
        Metadata only — platform admins never see tenant secrets.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Projects</TableHead>
            <TableHead>Service accts</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs.map((o) => (
            <TableRow key={o.id}>
              <TableCell className="font-medium">{o.name}</TableCell>
              <TableCell>
                <Badge variant="secondary">{o.type}</Badge>
              </TableCell>
              <TableCell>{o._count.memberships}</TableCell>
              <TableCell>{o._count.projects}</TableCell>
              <TableCell>{o._count.serviceAccounts}</TableCell>
              <TableCell>
                {o.status === 'active' ? (
                  <Badge>active</Badge>
                ) : (
                  <Badge variant="secondary">{o.status}</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant={o.status === 'suspended' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggle(o)}
                >
                  {o.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SystemTab() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [rotating, setRotating] = useState(false);
  const [rotateResult, setRotateResult] = useState<string | null>(null);

  async function refreshHealth() {
    setError('');
    try {
      setHealth(await getHealth());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health');
    }
  }

  useEffect(() => {
    void refreshHealth();
  }, []);

  async function handleRotate() {
    setError('');
    setRotating(true);
    setRotateResult(null);
    try {
      const res = await rotateKeys();
      setRotateResult(
        `Rotated ${res.rotated} secret version(s) to ${res.activeVersion}` +
          (res.failed.length ? `, ${res.failed.length} failed` : ''),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rotation failed');
    } finally {
      setRotating(false);
    }
  }

  function dot(up: boolean) {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${up ? 'bg-green-500' : 'bg-red-500'}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      {error && <p className="text-sm text-red-500">{error}</p>}

      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Health</h3>
            <Button variant="ghost" size="sm" onClick={refreshHealth}>
              Refresh
            </Button>
          </div>
          {health ? (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                {dot(health.database)} Database
              </div>
              <div className="flex items-center gap-2">
                {dot(health.cache)} Cache (Redis)
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Loading...</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Key rotation</h3>
              <p className="text-sm text-muted-foreground">
                Re-wraps data keys onto the active master key. Secret values are
                never touched.
              </p>
            </div>
            <Button onClick={handleRotate} disabled={rotating}>
              {rotating ? 'Rotating...' : 'Rotate keys'}
            </Button>
          </div>
          {rotateResult && (
            <p className="text-sm text-green-600 mt-3">{rotateResult}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
