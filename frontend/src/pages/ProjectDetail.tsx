import { useEffect, useState } from 'react';
import type { Project, Environment } from '@/lib/projects';
import { listEnvironments, createEnvironment } from '@/lib/secrets';
import { SecretsTable } from './SecretsTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface ProjectDetailProps {
  project: Project;
  onBack: () => void;
}

export function ProjectDetail({ project, onBack }: ProjectDetailProps) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setEnvironments(await listEnvironments(project.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [project.id]);

  async function handleCreateEnv() {
    try {
      await createEnvironment(project.id, newEnvName.trim());
      setNewEnvName('');
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <h2 className="text-xl font-semibold">{project.name}</h2>
      </div>

      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}
      {loading && <p className="text-muted-foreground">Loading...</p>}

      {!loading && environments.length === 0 && (
        <div className="flex flex-col items-start gap-4">
          <p className="text-muted-foreground">No environments yet.</p>
          <CreateEnvDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            name={newEnvName}
            onName={setNewEnvName}
            onCreate={handleCreateEnv}
          />
        </div>
      )}

      {!loading && environments.length > 0 && (
        <Tabs defaultValue={environments[0].id}>
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              {environments.map((env) => (
                <TabsTrigger key={env.id} value={env.id}>
                  {env.name}
                </TabsTrigger>
              ))}
            </TabsList>
            <CreateEnvDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              name={newEnvName}
              onName={setNewEnvName}
              onCreate={handleCreateEnv}
            />
          </div>
          {environments.map((env) => (
            <TabsContent key={env.id} value={env.id}>
              <SecretsTable environmentId={env.id} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function CreateEnvDialog({
  open,
  onOpenChange,
  name,
  onName,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  onName: (v: string) => void;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">New environment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create environment</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="envname">Name</Label>
          <Input
            id="envname"
            value={name}
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate()}
            placeholder="dev / staging / prod"
          />
        </div>
        <DialogFooter>
          <Button onClick={onCreate} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
