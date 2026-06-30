import { useCallback, useEffect, useState } from "react";
import {
  transferOwnership,
  renameOrganization,
  deleteOrganization,
  type OrgDetail,
} from "@/lib/organizations";
import {
  listServiceAccounts,
  createServiceAccount,
  deleteServiceAccount,
  listServiceAccountTokens,
  issueServiceAccountToken,
  revokeServiceAccountToken,
  type ServiceAccount,
  type ServiceAccountToken,
} from "@/lib/service-accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const selectClass = "border rounded-md h-9 px-3 text-sm bg-transparent";

export function ServiceAccountsTab({
  orgId,
  isAdmin,
  onChanged,
}: {
  orgId: string;
  isAdmin: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [accounts, setAccounts] = useState<ServiceAccount[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [tokensFor, setTokensFor] = useState<ServiceAccount | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      setAccounts(await listServiceAccounts(orgId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  return (
    <div>
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      {isAdmin && (
        <div className="flex items-end gap-2 mb-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Service account name</Label>
            <Input
              placeholder="ci-deploy"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-w-64"
            />
          </div>
          <Button
            disabled={!name.trim()}
            onClick={() =>
              run(async () => {
                await createServiceAccount(orgId, name.trim());
                setName("");
              })
            }
          >
            Create
          </Button>
        </div>
      )}

      {accounts.length === 0 ? (
        <p className="text-muted-foreground">No service accounts.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(a.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTokensFor(a)}
                  >
                    Tokens
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        run(() => deleteServiceAccount(orgId, a.id))
                      }
                    >
                      Delete
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {tokensFor && (
        <ServiceAccountTokensDialog
          orgId={orgId}
          account={tokensFor}
          canManage={isAdmin}
          onClose={() => setTokensFor(null)}
        />
      )}
    </div>
  );
}

function ServiceAccountTokensDialog({
  orgId,
  account,
  canManage,
  onClose,
}: {
  orgId: string;
  account: ServiceAccount;
  canManage: boolean;
  onClose: () => void;
}) {
  const [tokens, setTokens] = useState<ServiceAccountToken[]>([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      setTokens(await listServiceAccountTokens(orgId, account.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [orgId, account.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account.name} — tokens</DialogTitle>
          <DialogDescription>
            Tokens are shown once at creation. Use them as Bearer tokens / CLI
            credentials.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {canManage && (
          <div className="flex gap-2">
            <Input
              placeholder="label (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Button
              onClick={async () => {
                setError("");
                try {
                  const res = await issueServiceAccountToken(
                    orgId,
                    account.id,
                    label.trim() || undefined,
                  );
                  setNewToken(res.token);
                  setLabel("");
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed");
                }
              }}
            >
              Issue
            </Button>
          </div>
        )}

        {newToken && (
          <code className="block bg-muted p-3 rounded text-sm break-all">
            {newToken}
          </code>
        )}

        {tokens.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tokens.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.label ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.lastUsedAt
                      ? new Date(t.lastUsedAt).toLocaleDateString()
                      : "never"}
                  </TableCell>
                  <TableCell>
                    {t.revokedAt ? (
                      <Badge variant="secondary">revoked</Badge>
                    ) : (
                      <Badge>active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && !t.revokedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await revokeServiceAccountToken(
                            orgId,
                            account.id,
                            t.id,
                          );
                          await load();
                        }}
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsTab({
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
  const [name, setName] = useState(org.name);
  const [error, setError] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [pending, setPending] = useState<"transfer" | "delete" | null>(null);
  const isPersonal = org.type === "personal";

  const transferCandidates = org.members.filter(
    (m) => m.role !== "owner" && m.type === "human",
  );
  const transferTarget = transferCandidates.find(
    (m) => m.identityId === transferTo,
  );

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setError("");
    try {
      await fn();
      if (after) after();
      else await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {isOwner && !isPersonal && (
        <>
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Organization name</Label>
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
              <Button
                disabled={!isOwner && org.myRole !== "admin"}
                onClick={() =>
                  run(() => renameOrganization(org.id, name.trim()))
                }
              >
                Save
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-xs">Transfer ownership</Label>
            <div className="flex gap-2">
              <select
                className={`${selectClass} min-w-64`}
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
              >
                <option value="">Select a member…</option>
                {transferCandidates.map((m) => (
                  <option key={m.identityId} value={m.identityId}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                disabled={!transferTo}
                onClick={() => setPending("transfer")}
              >
                Transfer
              </Button>
            </div>
          </div>
        </>
      )}

      {isOwner && !isPersonal && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <Label className="text-xs text-red-500">Danger zone</Label>
          <Button
            variant="outline"
            className="text-red-500 w-fit"
            onClick={() => setPending("delete")}
          >
            Delete organization
          </Button>
          <p className="text-xs text-muted-foreground">
            Only possible once all projects and service accounts are removed.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={pending === "transfer"}
        title="Transfer ownership?"
        description={`Ownership of "${org.name}" will move to ${transferTarget?.name ?? "the selected member"}. You will become an admin.`}
        confirmLabel="Transfer"
        onConfirm={() => {
          setPending(null);
          void run(() => transferOwnership(org.id, transferTo));
        }}
        onClose={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === "delete"}
        title="Delete organization?"
        description={`This permanently deletes "${org.name}". This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setPending(null);
          void run(() => deleteOrganization(org.id), onDeleted);
        }}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
