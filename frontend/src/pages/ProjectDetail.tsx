import { useEffect, useState } from 'react';
import type { Project } from '@/lib/projects';
import { useSecrets } from '@/lib/secrets-context';
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

export function ProjectDetail({
  project,
  onBack,
}: {
  project: Project;
  onBack: () => void;
}) {
  const {
    getEnvironments,
    loadEnvironments,
    createEnvironment,
    getSecrets,
    loadSecrets,
    createSecret,
    deleteSecret,
  } = useSecrets();

  const environments = getEnvironments(project.id);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');

  // Завантажуємо оточення при першому відкритті проєкту (кеш живе глобально).
  useEffect(() => {
    loadEnvironments(project.id).catch((err) =>
      setError(err instanceof Error ? err.message : 'Failed to load'),
    );
  }, [project.id, loadEnvironments]);

  // Виставляємо активне оточення, коли список з'явився.
  useEffect(() => {
    if (environments && environments.length > 0 && !activeEnvId) {
      setActiveEnvId(environments[0].id);
    }
  }, [environments, activeEnvId]);

  // Лінива загрузка секретів активного оточення (раз).
  useEffect(() => {
    if (activeEnvId) {
      loadSecrets(activeEnvId).catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load secrets'),
      );
    }
  }, [activeEnvId, loadSecrets]);

  async function handleCreateEnv() {
    try {
      const created = await createEnvironment(project.id, newEnvName.trim());
      setNewEnvName('');
      setDialogOpen(false);
      setActiveEnvId(created.id);
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

      {environments === undefined && (
        <p className="text-muted-foreground">Loading...</p>
      )}

      {environments && environments.length === 0 && (
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

      {environments && environments.length > 0 && activeEnvId && (
        <Tabs value={activeEnvId} onValueChange={setActiveEnvId}>
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
              <SecretsTable
                secrets={getSecrets(env.id)}
                onAdd={(key, value) => createSecret(env.id, key, value)}
                onDelete={(id) => deleteSecret(env.id, id)}
              />
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
