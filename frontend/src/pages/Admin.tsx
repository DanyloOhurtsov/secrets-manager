import { useEffect, useState } from 'react';
import {
  listIdentities,
  createIdentity,
  type Identity,
} from '@/lib/admin';
import { IdentityDetail } from './IdentityDetail';
import { AuditLog } from './AuditLog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function Admin({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<Identity | null>(null);

  if (selected) {
    return (
      <IdentityDetail
        identity={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <h2 className="text-xl font-semibold">Access Management</h2>
      </div>

      <Tabs defaultValue="identities">
        <TabsList className="mb-4">
          <TabsTrigger value="identities">Identities</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="identities">
          <IdentitiesList onSelect={setSelected} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function IdentitiesList({ onSelect }: { onSelect: (i: Identity) => void }) {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('human');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setIdentities(await listIdentities());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate() {
    try {
      await createIdentity(name.trim(), type);
      setName('');
      setType('human');
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {identities.length} identit{identities.length === 1 ? 'y' : 'ies'}
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>New identity</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create identity</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="iname">Name</Label>
                <Input
                  id="iname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="maria / ci-bot"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="itype">Type</Label>
                <select
                  id="itype"
                  className="border rounded-md h-9 px-3 text-sm bg-transparent"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  <option value="human">human</option>
                  <option value="service">service</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!name.trim()}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
      {loading && <p className="text-muted-foreground">Loading...</p>}

      <div className="flex flex-col gap-2">
        {identities.map((i) => (
          <Card
            key={i.id}
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={() => onSelect(i)}
          >
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <span className="font-medium">{i.name}</span>
                <Badge variant="secondary">{i.type}</Badge>
                {i.isSuperadmin && <Badge>superadmin</Badge>}
              </div>
              <span className="text-sm text-muted-foreground">
                manage →
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
