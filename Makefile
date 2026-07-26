# Secrets Manager on a local kind cluster.
#
#   make cluster-up build-images load-images deploy bootstrap
#
# Full walkthrough: deploy/k8s/README.md

CLUSTER_NAME  ?= secrets-manager
NAMESPACE     ?= secrets-manager
K8S_DIR       ?= deploy/k8s
KIND_CONFIG   ?= kind-config.yaml

# Image tag. Deliberately NOT `latest`: Kubernetes forces imagePullPolicy to
# Always for the `latest` tag, which would make it ignore the image we
# side-loaded and try to pull from a registry that has never heard of it.
#
# Caveat: 30-migrate-job.yaml / 40-api.yaml / 50-dashboard.yaml hardcode `:dev`,
# so overriding TAG here builds an image the manifests do not reference. Change
# both, or leave it alone until you templatise with Helm/Kustomize.
TAG           ?= dev
BACKEND_IMAGE  = secrets-manager-backend:$(TAG)
FRONTEND_IMAGE = secrets-manager-frontend:$(TAG)

# Prefix every kubectl call with the namespace so no command depends on your
# current context's default namespace.
KUBECTL = kubectl --namespace $(NAMESPACE)

# Which workload `make logs` follows. Override: make logs COMPONENT=dashboard
COMPONENT ?= api

.DEFAULT_GOAL := help
.PHONY: help cluster-up cluster-down build-images load-images deploy undeploy \
        logs status bootstrap migrate-logs psql

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Cluster lifecycle
# ---------------------------------------------------------------------------

cluster-up: ## Create the kind cluster (idempotent)
	@if kind get clusters 2>/dev/null | grep -qx '$(CLUSTER_NAME)'; then \
		echo "==> cluster '$(CLUSTER_NAME)' already exists, skipping"; \
	else \
		echo "==> creating kind cluster '$(CLUSTER_NAME)'"; \
		kind create cluster --name $(CLUSTER_NAME) --config $(KIND_CONFIG); \
	fi
	@echo "==> kubectl context:"
	@kubectl config current-context

cluster-down: ## Delete the kind cluster and everything in it (destroys DB data)
	@echo "==> deleting kind cluster '$(CLUSTER_NAME)'"
	kind delete cluster --name $(CLUSTER_NAME)

# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------
# kind nodes are Docker containers with their OWN image store. Your local
# `docker images` is invisible to them, which is why building is not enough --
# `kind load` copies the image into every node. The alternative is running a
# real registry, which is more machinery than a learning cluster needs.

build-images: ## Build backend + frontend images locally
	@echo "==> building $(BACKEND_IMAGE)"
	docker build --build-arg APP_VERSION=$(TAG) -t $(BACKEND_IMAGE) ./backend
	@echo "==> building $(FRONTEND_IMAGE)"
	docker build -t $(FRONTEND_IMAGE) ./frontend

load-images: ## Side-load the built images into the kind cluster's nodes
	@echo "==> loading images into kind cluster '$(CLUSTER_NAME)'"
	kind load docker-image $(BACKEND_IMAGE)  --name $(CLUSTER_NAME)
	kind load docker-image $(FRONTEND_IMAGE) --name $(CLUSTER_NAME)
	@echo "==> loaded. Rebuilt an image? Re-run load-images, then:"
	@echo "    $(KUBECTL) rollout restart deployment/api deployment/dashboard"

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

deploy: ## Apply all manifests in dependency order and wait for readiness
# 02-secret.yaml is gitignored (it holds the master key), so on a fresh clone it
# does not exist and `kubectl apply` would fail with a bare "no such file".
# Generating that key is step 1 here, exactly as it is for compose.
	@test -f $(K8S_DIR)/02-secret.yaml || ( \
		echo "!!! $(K8S_DIR)/02-secret.yaml is missing (it is gitignored on purpose)."; \
		echo ""; \
		echo "    cp $(K8S_DIR)/02-secret.yaml.example $(K8S_DIR)/02-secret.yaml"; \
		echo "    echo \"v1:\$$(openssl rand -hex 32)\"   # paste as MASTER_KEYS"; \
		echo ""; \
		echo "    Never reuse a key from a repository -- see SECURITY.md."; \
		exit 1 )

	@echo "==> namespace + config"
	kubectl apply -f $(K8S_DIR)/00-namespace.yaml
	$(KUBECTL) apply -f $(K8S_DIR)/01-configmap.yaml
	$(KUBECTL) apply -f $(K8S_DIR)/02-secret.yaml

	@echo "==> stateful dependencies"
	$(KUBECTL) apply -f $(K8S_DIR)/10-postgres.yaml
	$(KUBECTL) apply -f $(K8S_DIR)/20-redis.yaml
	@echo "==> waiting for postgres to be ready"
	$(KUBECTL) rollout status statefulset/postgres --timeout=180s

	@echo "==> migrations"
# Most of a Job's spec is immutable once created, so re-applying over a
# finished Job fails with "field is immutable". Delete, then recreate.
	$(KUBECTL) delete job db-migrate --ignore-not-found
	$(KUBECTL) apply -f $(K8S_DIR)/30-migrate-job.yaml
# `kubectl wait` takes a single condition, so a FAILED job would just sit here
# until the timeout. Dumping the logs on failure turns a timeout into an
# actionable error.
	@$(KUBECTL) wait --for=condition=complete job/db-migrate --timeout=300s \
		|| ( echo "!!! migration job did not complete -- logs follow:"; \
		     $(KUBECTL) logs job/db-migrate --all-containers --tail=100; \
		     exit 1 )

	@echo "==> application"
	$(KUBECTL) apply -f $(K8S_DIR)/40-api.yaml
	$(KUBECTL) apply -f $(K8S_DIR)/50-dashboard.yaml
# Env vars are read once at container start, so a changed ConfigMap/Secret has
# no effect on running pods. Restarting makes `make deploy` mean what you expect
# after editing config.
#
# On a FIRST install this still triggers a second rollout (it stamps a
# restartedAt annotation, which is a template change, which makes a new
# ReplicaSet). Cheap, because the first pods have barely started. The tidier
# alternative is to hash the ConfigMap into a pod annotation so pods roll only
# when the config actually changed -- that is what Helm's checksum/config
# pattern does, and it is a good reason to graduate to a templating tool.
	$(KUBECTL) rollout restart deployment/api deployment/dashboard
	$(KUBECTL) rollout status deployment/api --timeout=180s
	$(KUBECTL) rollout status deployment/dashboard --timeout=120s

	@echo ""
	@echo "==> ready"
	@echo "    dashboard  http://localhost:8080"
	@echo "    API        http://localhost:3000"
	@echo "    next:      make bootstrap"

undeploy: ## Delete the namespace (removes all workloads AND the Postgres PVC)
	kubectl delete namespace $(NAMESPACE) --ignore-not-found

# ---------------------------------------------------------------------------
# Operate
# ---------------------------------------------------------------------------

logs: ## Follow logs (default: api; e.g. make logs COMPONENT=dashboard)
	$(KUBECTL) logs -l app.kubernetes.io/name=$(COMPONENT) \
		--all-containers --prefix --tail=100 --follow

migrate-logs: ## Show the migration Job's output
	$(KUBECTL) logs job/db-migrate --all-containers --tail=200

status: ## Show pods, services and persistent volume claims
	@echo "--- pods ---"      && $(KUBECTL) get pods -o wide
	@echo "--- services ---"  && $(KUBECTL) get svc
	@echo "--- storage ---"   && $(KUBECTL) get pvc
	@echo "--- jobs ---"      && $(KUBECTL) get jobs

bootstrap: ## Create the first superadmin and print its API token (run once)
# A Job, NOT `kubectl exec` into the API. The exec form ran `npx ts-node` inside
# the serving container's cgroup and OOM-killed the API (exit 137). See the
# header of 60-bootstrap-job.yaml.
#
# Job specs are largely immutable, so delete before apply -- same handling as
# db-migrate in `deploy`.
	@$(KUBECTL) delete job bootstrap --ignore-not-found
	@$(KUBECTL) apply -f $(K8S_DIR)/60-bootstrap-job.yaml
# A failed Job would otherwise sit here until the timeout with no explanation,
# so dump the logs on failure and exit non-zero.
	@$(KUBECTL) wait --for=condition=complete job/bootstrap --timeout=180s \
		|| ( echo "!!! bootstrap job did not complete -- logs follow:"; \
		     $(KUBECTL) logs job/bootstrap --all-containers --tail=100; \
		     $(KUBECTL) delete job bootstrap --ignore-not-found; \
		     exit 1 )
	@echo ""
	@$(KUBECTL) logs job/bootstrap
# Delete only AFTER printing: the token exists nowhere else (the database stores
# just its SHA-256 hash), so the log is the one delivery. Removing the Job then
# takes the token back out of cluster state.
	@$(KUBECTL) delete job bootstrap --ignore-not-found

psql: ## Open a psql shell against the cluster's Postgres
# This one stays `kubectl exec`, deliberately. An INTERACTIVE session against a
# process that is already running is what exec is for -- there is nothing
# one-shot to schedule. It also targets the database pod, not a pod serving HTTP,
# and starts a psql client rather than a compiler, so it cannot repeat the
# bootstrap OOM. The rule is "one-shot work gets a Job", not "never exec".
	@$(KUBECTL) exec -it statefulset/postgres -- \
		sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'
