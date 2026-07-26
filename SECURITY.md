# Security

## A master key was published in this repository

**Any `MASTER_KEYS` value obtained from this repository before 2026-07-26 is
public. It must never be used to encrypt anything.**

`backend/.env.example` shipped a real 32-byte master key as its example value from
the commit that introduced the file until 2026-07-26. For part of that period
`docker-compose.yml` also used the same key as a silent shell default
(`${MASTER_KEYS:-v1:…}`), which means anyone who followed the quickstart and ran
`docker compose up` without setting `MASTER_KEYS` themselves encrypted their
secrets under a key that is readable by anyone who clones this repository.

The affected key begins `ec03de45`. To check whether you are affected:

```bash
grep -r 'ec03de45' .env backend/.env deploy/k8s/02-secret.yaml 2>/dev/null
docker compose exec backend printenv MASTER_KEYS | cut -c1-12
kubectl -n secrets-manager get secret app-secrets \
  -o jsonpath='{.data.MASTER_KEYS}' | base64 -d | cut -c1-12
```

If any of those show `v1:ec03de45`, treat **every secret ever stored in that
installation as disclosed** and follow the recovery path below.

### What has been done

- The value is removed from `backend/.env.example`, which now ships an empty
  `MASTER_KEYS=""` and instructions to generate your own.
- `docker-compose.yml` uses `${MASTER_KEYS:?…}`, so the stack fails closed instead
  of falling back to a shared key. There is no default and there never will be.
- Generating a key is step 1 of the quickstart, before anything starts.
- `scripts/secret-scan.sh` fails on a 64-hex literal in a tracked file. It runs
  in two places: a `pre-commit` hook, so a key is blocked before it leaves the
  machine, and CI, as the backstop for anyone who has not enabled hooks or who
  commits with `--no-verify`. Enable the hook once per clone:

  ```bash
  git config core.hooksPath .githooks
  ```

### Why the git history was not rewritten

This repository is public and has been cloned and forked. Rewriting history with
`git filter-repo` would break every fork and every existing clone while
**un-publishing nothing** — the old objects remain in every copy already made, in
forks on GitHub, and in any archive or mirror. A key that has been public is
public permanently.

The correct response to a disclosed key is therefore rotation plus fixing the
cause that disclosed it, which is what has been done. The value is left in
history deliberately, so this document can point at it.

## Recovering from a compromised master key

**Rotation alone is not sufficient if secrets were stored under the leaked key.**
This is the part that is easy to get wrong, so it is worth being precise about
what rotation does and does not do.

Secrets use envelope encryption: each secret value is encrypted with its own
random data key, and that data key is wrapped with the master key.
`POST /admin/rotate-keys` (`backend/src/admin/rotation.service.ts`) **only
re-wraps data keys** — it decrypts each data key with its old master key version
and re-encrypts it under the active one. It never re-encrypts the secret value
itself, by design: that keeps rotation cheap and idempotent.

The consequence: after rotating, a *current* database dump is safe, because the
stored wrapped data keys are now under the new master key. But anyone holding an
*older* dump — taken while the leaked key was active — still has the data keys
wrapped under a key that is public, and the value ciphertext is byte-for-byte
unchanged. They can still decrypt it.

So if you ever ran with the leaked key, you must rotate the master key **and**
re-enter every secret value, which mints a fresh data key per value:

1. Generate a new key and append it as a new version — keep the old one for now,
   or existing rows become unreadable:

   ```bash
   echo "v2:$(openssl rand -hex 32)"
   # MASTER_KEYS="v1:<old>,v2:<new>"
   ```

2. Set `ACTIVE_KEY_VERSION=v2` and restart the API. New secrets are now wrapped
   with `v2`; existing ones still decrypt with `v1`.

3. Re-wrap the existing data keys:

   ```bash
   curl -X POST http://localhost:3000/admin/rotate-keys \
     -H "Authorization: Bearer sm_…"     # superadmin token
   ```

   This is idempotent — versions already on the active key are skipped.

4. **Change the secret values themselves.** Rotate the underlying credentials at
   their source (database passwords, API keys, tokens) and save the new values
   through the UI or API. This is the step that actually revokes access, because
   the old ciphertext and its data key are what an old dump contains. A leaked
   master key means the credentials it protected are disclosed, not just the
   envelope around them.

5. Once every `SecretVersion` is on `v2`, drop `v1` from `MASTER_KEYS` and
   restart.

## Reporting a vulnerability

Open a private security advisory through GitHub's **Security → Report a
vulnerability** on this repository. Please do not open a public issue for
anything exploitable.

## Notes on the development defaults

These are intentional and are not production configuration:

- `dev:dev` Postgres credentials in `docker-compose.yml`,
  `deploy/k8s/01-configmap.yaml` and `backend/.env.example` — a throwaway local
  database that is not published beyond the host.
- `deploy/k8s/` exposes the API and dashboard on NodePorts with no TLS, and
  `TRUST_PROXY` is deliberately unset because the API is reachable directly.
  See `deploy/k8s/README.md`.
- A Kubernetes `Secret` is base64, not encryption. `deploy/k8s/02-secret.yaml` is
  gitignored and generated from `02-secret.yaml.example`; in production the master
  key belongs in a KMS/HSM, not in a manifest. A secrets manager must keep its own
  root key outside the system it protects.
