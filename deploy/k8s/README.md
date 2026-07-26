# Running Secrets Manager on a local kind cluster

Raw Kubernetes manifests — no Helm, no Kustomize, no Ingress controller. Every
field is commented in the YAML itself; this file is the operating manual.

The manifests are numbered in dependency order and `make deploy` applies them in
that order, waiting at each gate.

| File | What it creates |
|---|---|
| `00-namespace.yaml` | `Namespace/secrets-manager` |
| `01-configmap.yaml` | `ConfigMap/app-config` — non-sensitive config |
| `02-secret.yaml` | `Secret/app-secrets` — DB password + `MASTER_KEYS` |
| `10-postgres.yaml` | headless `Service/postgres` + `StatefulSet/postgres` (+ its PVC) |
| `20-redis.yaml` | `Service/redis` + `Deployment/redis` |
| `30-migrate-job.yaml` | `Job/db-migrate` — `prisma migrate deploy`, runs once |
| `40-api.yaml` | `Service/backend` (NodePort 30000) + `Deployment/api` ×2 |
| `50-dashboard.yaml` | `Service/dashboard` (NodePort 30080) + `Deployment/dashboard` ×2 |
| `60-bootstrap-job.yaml` | `Job/bootstrap` — first superadmin + its token, run on demand |

`60-bootstrap-job.yaml` is not applied by `make deploy` — it is an on-demand
administrative task, run by `make bootstrap`.

`kind-config.yaml` and the `Makefile` live at the repository root.

---

## Prerequisites

```bash
docker version          # Docker Desktop must be running
kubectl version --client
kind version            # if missing:  brew install kind
```

First `make deploy` also pulls `postgres:16` and `redis:7` from Docker Hub onto
the kind node, so the first run needs network. To work offline afterwards, warm
them into the node once:

```bash
docker pull postgres:16 && docker pull redis:7
kind load docker-image postgres:16 redis:7 --name secrets-manager
```

---

## Zero to working install

```bash
# 1. Create the cluster. Publishes node ports 30080/30000 to host 8081/3001.
make cluster-up

# 2. Build the two application images locally (tagged :dev, not :latest).
make build-images

# 3. Copy them into the kind node's image store. Without this the kubelet
#    cannot see your local Docker images at all.
make load-images

# 4. Apply everything in order and block until it is actually up.
make deploy

# 5. Create the first superadmin. Runs Job/bootstrap in its own pod, prints
#    its log, then deletes the Job. Prints an sm_… token — copy it, it is
#    shown once. Idempotent: re-running just reports the existing superadmin.
make bootstrap
```

Then:

- Dashboard — <http://localhost:8081> (log in with the token from step 5)
- API — <http://localhost:3001> (landing page) / `/health` / `/info`
- CLI — `export SECRETS_API_URL=http://localhost:3001` then
  `secrets login --token sm_…`

> **Why 8081/3001 and not 8080/3000?** A docker compose stack occupies the
> originals, so `kind-config.yaml` publishes one port higher. These are *host*
> ports only. Nothing inside the cluster moved: the API Service is still on
> 3000, and `nginx.conf`'s `proxy_pass http://backend:3000/` is unaffected.
> If you are running the compose stack instead of kind, its URLs are still
> 8080/3000 — see the root README.

### Verify

```bash
make status
curl -s http://localhost:3001/health
curl -s http://localhost:8081/api/health   # proves the nginx -> backend proxy works
```

`make status` should show `postgres-0`, one `db-migrate` pod `Completed`, and
two `api` + two `dashboard` pods `Running` and `2/2` ready.

---

## What `make deploy` actually does

Kubernetes has no `depends_on`. Compose's
`depends_on: {condition: service_healthy}` has no declarative equivalent, so
ordering is built from three separate mechanisms:

1. **`kubectl rollout status statefulset/postgres`** — the Makefile blocks until
   Postgres passes its readiness probe before creating the migration Job.
2. **`kubectl wait --for=condition=complete job/db-migrate`** — blocks until
   migrations finish before the API is applied. This is the strong guarantee.
3. **The `wait-for-migrations` init container** in `40-api.yaml` — polls for
   Postgres accepting connections *and* the `_prisma_migrations` table existing.
   This is the safety net so a bare `kubectl apply -f deploy/k8s/` also
   converges, without the Makefile's sequencing.

The init container's check is deliberately weaker than #2: it proves the schema
exists, not that every migration has been applied. In a `kubectl apply -f`
race it can wave the API through while the Job is still mid-run. For a learning
cluster that is fine; the Makefile path is the one with real ordering.

**`make deploy` is safe to re-run.** It deletes and recreates the migration Job
each time (most of a Job's spec is immutable, so re-applying over a finished one
fails), and ends with `rollout restart` so ConfigMap/Secret edits actually take
effect.

---

## Day-2 loops

```bash
# Changed backend or frontend CODE (same manifest, new image)
make build-images load-images
kubectl -n secrets-manager rollout restart deployment/api deployment/dashboard

# Changed a MANIFEST (.yaml) — restart alone does nothing here, see below
kubectl -n secrets-manager apply -f deploy/k8s/50-dashboard.yaml
# ...or just: make deploy

# Changed ConfigMap or Secret values (env vars are read once at startup —
# editing the object alone does NOTHING to running pods)
make deploy

# Added a Prisma migration
kubectl -n secrets-manager delete job db-migrate
kubectl -n secrets-manager apply -f deploy/k8s/30-migrate-job.yaml
make migrate-logs

# Watch logs / open a psql shell
make logs                      # api by default
make logs COMPONENT=dashboard
make psql
```

**`rollout restart` is not `apply`.** This catches people, and the failure is
silent. `rollout restart` stamps an annotation on the Deployment that is
*already in the cluster* and recreates its pods from that stored spec — it never
looks at your files. Edit a manifest, run `rollout restart`, and you get brand
new pods running the **old** spec, with a rollout that reports success.

The tell is that the cluster keeps doing something your file no longer says:
probes hitting port 80 while the manifest reads 8080, a container port that will
not change, an added env var that never appears. `kubectl apply` is what sends
the file; the restart is only needed afterwards for things pods read once at
startup, like ConfigMap-sourced env vars. `make deploy` does both, in that
order.

### Teardown

```bash
make undeploy      # delete the namespace; keeps the cluster, DESTROYS the PVC
make cluster-down  # delete the whole cluster
```

Note that deleting a StatefulSet does *not* delete its PVC — that is a
data-safety default. Deleting the namespace does.

---

## Where this app fights Kubernetes

Read this before you change anything. Every item is a real property of the
current code, not a hypothetical.

### 1. Migrations were in the image's `CMD`

`backend/Dockerfile` ends with `npx prisma migrate deploy && node dist/src/main`.
One container, correct. Two replicas, and every pod races to migrate on every
rollout — `migrate deploy` takes a Postgres advisory lock so the losers block
rather than corrupt, but you have serialised startup on a lock and hidden schema
changes inside a rollout.

**Handled:** `30-migrate-job.yaml` owns migrations; `40-api.yaml` overrides
`command` to just `node dist/src/main`. Both use the same image — multi-stage,
production dependencies only, but with the Prisma CLI and `prisma/migrations/`
deliberately retained because the Job needs them. Compose still works exactly as
before, via the image's `CMD`.

### 2. `DATABASE_URL` is one string with the password inside it

The classic config-split snag. Host and database name want to be in a ConfigMap;
the password must be in a Secret; the app wants them concatenated. You cannot
reference half a value.

**Handled:** the parts are stored separately and reassembled in the pod spec
using Kubernetes `$(VAR)` env interpolation. Two rules make this work — the
referenced variable must be defined *earlier in the same `env:` list*, and it
must come from `env:`, not from `envFrom:` (bulk-imported variables are not
available to expansion). That is why these manifests spell out every variable
individually instead of using the shorter `envFrom`.

**Sharp edge:** a password containing `@ : / ? # %` will corrupt the URL. Either
keep it alphanumeric or move the whole pre-built URL into the Secret as one key.

### 3. `KeyProvider` throws in its constructor

Bad or missing `MASTER_KEYS` / `ACTIVE_KEY_VERSION` throws before Nest finishes
building the module graph — before Express binds a port. So this is not a
failing probe, it is a pod that never starts. No amount of probe tuning surfaces
it; `kubectl logs` is the only place the reason appears.

This is correct fail-fast behaviour, and it stays correct here. Just know that
`CrashLoopBackOff` with zero probe activity means "check the logs for a config
error", not "the app is slow to start".

### 4. `nginx.conf` hardcodes `proxy_pass http://backend:3000/`

Baked into the frontend image at build time. In Compose that resolved because
the service was named `backend`; here it resolves only because `40-api.yaml`
names the Service `backend` in the same namespace.

**Rename the API Service and the dashboard 502s** while the API itself is
perfectly healthy — nginx logs `host not found in upstream`. This is build-time
config leaking into deploy-time topology. The clean fix is to mount a ConfigMap
over `/etc/nginx/conf.d/default.conf` so the upstream becomes deploy-time
config; it is not done here to keep the manifest count honest.

The same applies to the SPA generally: it is compiled to static files, so an API
base URL or feature flag fixed at `npm run build` cannot be changed with a
ConfigMap. This app sidesteps that by being same-origin, which is the better
answer anyway.

### 5. ConfigMap changes do not restart pods

Env vars are injected once at container start. `kubectl edit configmap` changes
nothing until a rollout. (Mounted as a *volume* a ConfigMap does update in place,
but the app reads env, not files.) `make deploy` ends with `rollout restart` for
exactly this reason.

### 6. Health probes consume the rate-limit bucket

`ThrottlerGuard` is registered before `AuthGuard` in `app.module.ts`, and
`@Public()` only bypasses auth — so kubelet's `/health` probes count against the
100-request-per-minute-per-IP limit. Probes originate from the node, so all pods
on a node share one bucket.

Current budget: ~9 req/min per pod (6 readiness + 3 liveness), ~18/min for two
pods on kind's single node, against a limit of 100. Comfortable. But drop
`periodSeconds` to 1 and you will rate-limit your own liveness probe into a
restart loop that looks exactly like an application crash.

### 7. `TRUST_PROXY` is a trap in this topology

The dashboard's nginx sets `X-Forwarded-For`, so it is tempting to set
`TRUST_PROXY=1` for real client IPs in rate limiting. But this deployment also
exposes the API directly on NodePort 30000, so any client could forge that
header and walk past the IP throttler entirely. **Left unset** — Express then
uses the socket IP, which is always truthful. Set it only once the API is
reachable exclusively through the proxy.

### 8. SIGTERM is not handled — rollouts are not quite zero-downtime

`main.ts` never calls `app.enableShutdownHooks()`, so Nest registers no signal
handler and `onModuleDestroy` (`PrismaService.$disconnect`,
`CacheService.redis.quit`) does not run. Node's default action for an unhandled
SIGTERM is immediate termination.

Impact is small — requests are short, readiness removal stops new traffic first,
and both Postgres and Redis reap dropped connections — but in-flight requests are
cut off rather than drained, so a rollout can return a few connection resets.
Adding `app.enableShutdownHooks()` to `main.ts` is the one-line application
change that closes this. It is an app change, not a manifest change, so it is
left for you to make deliberately.

### 9. `readOnlyRootFilesystem` is off for the API

Not an oversight. The app would tolerate it — there is not a single filesystem
write in `backend/src` (no uploads, no local cache, logs go to stdout). What
does not tolerate it is `npx`, which wants a writable `HOME` and is still on the
boot path via the image's `CMD`.

Both of the other reasons are now gone: the `ts-node` bootstrap script (item 10)
and the fat image. The runtime image is multi-stage and carries no compiler —
only the Prisma CLI, which the migration Job genuinely needs. Turning
`readOnlyRootFilesystem` on is now a small change: an `emptyDir` at `/tmp` plus
one for the npm cache, or dropping `npx` from the `CMD` entirely.

### 10. One-shot admin tasks must not run inside serving pods

`make bootstrap` used to be `kubectl exec deployment/api -- npx ts-node
src/bootstrap.ts`. That is a natural thing to reach for and it is wrong, because
`kubectl exec` runs the command inside an existing container — sharing its
cgroup, and therefore its memory limit. `npx ts-node` starts a second Node
process and compiles TypeScript in memory, next to a NestJS app already using
most of the 512Mi limit in `40-api.yaml`. The kernel resolved it by killing the
largest process in the cgroup: the API. Both replicas terminated with
`reason: OOMKilled`, `exitCode: 137`.

**Handled:** `60-bootstrap-job.yaml` — its own pod, its own (smaller) limits,
running compiled `node dist/src/bootstrap` rather than recompiling at runtime.

The rule this leaves behind: **anything one-shot gets a Job.** `kubectl exec` is
for interactive inspection of a process that is already running — which is why
`make psql` (a shell against the Postgres StatefulSet) is fine and stays. It
spawns a client, not a compiler, and it does not target a pod serving requests.

### 11. `drop: ["ALL"]` broke nginx, and the error did not say so

The dashboard used to run without `runAsNonRoot`, justified in the manifest by
"stock nginx must be root to bind port 80". That explanation was wrong, and it
sent debugging in the wrong direction.

The pod crashed with:

```
nginx: [emerg] chown("/var/cache/nginx/client_temp", ...) Operation not permitted
```

The container *was* root. What it lacked was `CAP_CHOWN`, dropped by
`capabilities: drop: ["ALL"]` in the same securityContext. **Root without
capabilities is not root.** nginx chowns its cache directories at startup, that
syscall was denied, and it aborted — before ever reaching a `listen()` call, so
the privileged-port theory could not have been the cause.

**Handled:** the fix was the base image, not the securityContext.
`frontend/Dockerfile` uses `nginxinc/nginx-unprivileged`, which runs as uid 101,
listens on 8080 (above 1024, so no `CAP_NET_BIND_SERVICE` either) and ships its
cache paths already owned by that uid — nothing to chown. `50-dashboard.yaml`
now sets `runAsNonRoot: true`, which makes the kubelet refuse the pod outright
if the image is ever switched back to a root-assuming one.

The general shape worth keeping: "runs as root" and "has the capability it
needs" are independent, and dropping all capabilities breaks root-assuming
images with errors that never mention capabilities.

### What is already Kubernetes-friendly

Worth knowing what you *don't* have to fix:

- **No in-memory session state.** Sessions are rows in the `Session` table,
  looked up by SHA-256 hash; API tokens likewise. Redis holds only a 30-second
  verification cache. Nothing lives in process memory that a second replica
  would miss — which is why `api` runs 2 replicas here as a proof.
- **No filesystem writes** anywhere in `backend/src`.
- **Redis degrades gracefully.** `CacheService` swallows its own errors;
  `RedisThrottlerStorage` logs a warning and falls back to a per-process
  counter. So Redis is *not* a startup dependency and needs no ordering gate.
  The one caveat: with Redis down and N replicas, the effective rate limit is
  roughly N× the intended one — degraded, not broken.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ErrImagePull` / `ImagePullBackOff` on `api` or `dashboard` | Image not in the kind node's store, or you retagged to `:latest` (which forces `imagePullPolicy: Always`) | `make build-images load-images`; keep the `:dev` tag |
| `api` pod stuck `Init:0/1` | `wait-for-migrations` is still polling — Postgres down or the Job has not run | `make status`, then `make migrate-logs` |
| `api` `CrashLoopBackOff`, no probe activity | `KeyProvider` threw: bad `MASTER_KEYS` or `ACTIVE_KEY_VERSION` not in the ring | `make logs`, fix `02-secret.yaml`/`01-configmap.yaml`, `make deploy` |
| `db-migrate` never completes | Postgres unreachable, or a migration genuinely failed | `make migrate-logs` |
| Dashboard loads, every API call 502s | The API Service is not named `backend`, or has no ready endpoints | `kubectl -n secrets-manager get endpoints backend` |
| `field is immutable` applying the Job | Re-applying over a finished Job | `kubectl -n secrets-manager delete job db-migrate` first (`make deploy` does this) |
| localhost:8081 refused | Cluster created without `kind-config.yaml`, so no port mapping exists | `make cluster-down cluster-up` — port mappings cannot be added to a live cluster |
| localhost:8080 / :3000 shows something unexpected | Those are the **docker compose** ports, not the cluster's. kind is on 8081/3001 | `docker compose ps` to see what is answering |
| Config edit had no effect | Env vars are read once at container start | `make deploy` (it runs `rollout restart`) |
| `make bootstrap` says a superadmin already exists | It is idempotent by design | Issue a new token via `POST /admin/identities/:id/tokens` |
| `dashboard` `CrashLoopBackOff`; logs show `nginx: [emerg] chown("/var/cache/nginx/client_temp", ...) Operation not permitted` | A root-assuming nginx image plus `capabilities: drop: ["ALL"]`. Root without `CAP_CHOWN` cannot chown its cache dir, so nginx aborts at startup. Nothing to do with binding port 80 | Use `nginxinc/nginx-unprivileged` (uid 101) with a `listen` port above 1024 — see item 11. Do **not** "fix" it by re-adding capabilities |
| Edited a manifest, ran `rollout restart`, nothing changed | `rollout restart` recreates pods from the spec **already stored in the cluster**. It never reads your files. Your edit is still on disk only | `kubectl apply -f <file>` (or `make deploy`) first, *then* the restart. Symptom to watch for: probes still hitting the old port while the file says the new one |

Useful one-liners:

```bash
kubectl -n secrets-manager describe pod -l app.kubernetes.io/name=api
kubectl -n secrets-manager get events --sort-by=.lastTimestamp | tail -20
kubectl -n secrets-manager get endpoints backend      # empty => selector/readiness problem
kubectl -n secrets-manager exec -it deployment/api -- env | grep -E 'DATABASE|REDIS|KEY'
```

That last one does exec into a serving pod, which item 10 warns about — it is
fine because `env` is a coreutil that allocates nothing measurable. The hazard is
starting a *second heavy process* (a compiler, a migration, a bulk script) in a
cgroup that is already near its limit, not exec itself.

That last one is the fastest way to confirm the `$(VAR)` interpolation in
`DATABASE_URL` actually resolved — if you see a literal `$(POSTGRES_PASSWORD)`
in the output, an env var was referenced before it was defined.

---

## Deliberately not here

Natural next steps, roughly in order of how much you would learn:

- **Ingress** — replace both NodePorts with an ingress-nginx controller and one
  hostname. Requires `kubeadmConfigPatches` + `node-labels` in `kind-config.yaml`.
- **`app.enableShutdownHooks()`** — the one-line app change from item 8.
- **ConfigMap-mounted `nginx.conf`** — removes the `backend` name coupling.
- **Helm** — these files parameterise almost directly into a chart; the values
  are already split along ConfigMap/Secret lines.
- **NetworkPolicy** — kind's default CNI does not enforce them; needs Calico.
  Currently any pod in the cluster can reach Postgres directly.
- **PodDisruptionBudget + HPA** — meaningful only on a multi-node cluster.
- **Secret encryption at rest** — the honest gap. A native Secret is base64, not
  encryption. Real answers: an api-server `EncryptionConfiguration`, External
  Secrets Operator, or SOPS. Note the irony that a secrets manager must keep its
  own root key outside the system it protects — `MASTER_KEYS` is the bootstrap
  key that unwraps everything else, so in production it belongs in a cloud
  KMS/HSM, not in `02-secret.yaml`.
