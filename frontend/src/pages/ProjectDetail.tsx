import { useEffect, useState } from 'react';
import {
  getProjectCapabilities,
  type Project,
  type ProjectCapabilities,
} from '@/lib/projects';
import { useSecrets } from '@/lib/secrets-context';
import { notifyError } from '@/lib/errors';
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
    renameEnvironment,
    getSecrets,
    loadSecrets,
    getCapabilities,
    loadCapabilities,
    createSecret,
    importSecrets,
    updateSecret,
    rollbackSecret,
    loadVersions,
    revealSecret,
    deleteSecret,
  } = useSecrets();

  const environments = getEnvironments(project.id);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null);
  const [projectCaps, setProjectCaps] = useState<ProjectCapabilities | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');

  const activeEnv = environments?.find((e) => e.id === activeEnvId);

  // Створення оточення вимагає manageProject на рівні проєкту — без цього дозволу
  // ховаємо кнопку "New environment".
  const canManageProject = !!projectCaps?.manageProject;

  // Завантажуємо оточення та дозволи проєкту при першому відкритті (кеш глобальний).
  useEffect(() => {
    loadEnvironments(project.id).catch(notifyError);
    getProjectCapabilities(project.id)
      .then(setProjectCaps)
      .catch(() => setProjectCaps(null));
  }, [project.id, loadEnvironments]);

  // Виставляємо активне оточення, коли список з'явився.
  useEffect(() => {
    if (environments && environments.length > 0 && !activeEnvId) {
      setActiveEnvId(environments[0].id);
    }
  }, [environments, activeEnvId]);

  // Лінива загрузка секретів та дозволів активного оточення (раз).
  useEffect(() => {
    if (activeEnvId) {
      loadSecrets(activeEnvId).catch(notifyError);
      loadCapabilities(activeEnvId).catch(() => {
        /* без дозволів просто ховаємо кнопки дій — не блокуємо перегляд */
      });
    }
  }, [activeEnvId, loadSecrets, loadCapabilities]);

  async function handleCreateEnv() {
    try {
      const created = await createEnvironment(project.id, newEnvName.trim());
      setNewEnvName('');
      setDialogOpen(false);
      setActiveEnvId(created.id);
    } catch (err) {
      notifyError(err);
    }
  }

  function openRename() {
    if (!activeEnv) return;
    setRenameName(activeEnv.name);
    setRenameOpen(true);
  }

  async function handleRenameEnv() {
    if (!activeEnvId) return;
    try {
      await renameEnvironment(project.id, activeEnvId, renameName.trim());
      setRenameOpen(false);
    } catch (err) {
      notifyError(err);
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

      {environments === undefined && (
        <p className="text-muted-foreground">Loading...</p>
      )}

      {environments && environments.length === 0 && (
        <div className="flex flex-col items-start gap-4">
          <p className="text-muted-foreground">No environments yet.</p>
          {canManageProject && (
            <CreateEnvDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              name={newEnvName}
              onName={setNewEnvName}
              onCreate={handleCreateEnv}
            />
          )}
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
            {canManageProject && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={openRename}>
                  Rename
                </Button>
                <CreateEnvDialog
                  open={dialogOpen}
                  onOpenChange={setDialogOpen}
                  name={newEnvName}
                  onName={setNewEnvName}
                  onCreate={handleCreateEnv}
                />
              </div>
            )}
          </div>
          {environments.map((env) => (
            <TabsContent key={env.id} value={env.id}>
              <SecretsTable
                secrets={getSecrets(env.id)}
                capabilities={getCapabilities(env.id)}
                onAdd={(key, value) => createSecret(env.id, key, value)}
                onImport={(content) => importSecrets(env.id, content)}
                onUpdate={(id, value) => updateSecret(env.id, id, value)}
                onRollback={(id, toVersion) =>
                  rollbackSecret(env.id, id, toVersion)
                }
                onLoadVersions={(id) => loadVersions(env.id, id)}
                onReveal={(id) => revealSecret(env.id, id)}
                onDelete={(id) => deleteSecret(env.id, id)}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}

      <RenameEnvDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        name={renameName}
        onName={setRenameName}
        onRename={handleRenameEnv}
      />
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

function RenameEnvDialog({
  open,
  onOpenChange,
  name,
  onName,
  onRename,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  onName: (v: string) => void;
  onRename: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename environment</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="renameenvname">Name</Label>
          <Input
            id="renameenvname"
            value={name}
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onRename()}
            placeholder="dev / staging / prod"
          />
        </div>
        <DialogFooter>
          <Button onClick={onRename} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
