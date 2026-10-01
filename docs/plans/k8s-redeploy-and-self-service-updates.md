# K8s redeploy: new namespace, new paths, secrets, and self-service updates

## Context

The cluster state (`kubectl get all -n ma-bela-veltrup`) shows the live deployment is stale
relative to this repo:

- It's running `game-api`/`game-ui` pods wired to **MongoDB** (`mlops-game-mongodb`,
  `mlops-game-mongo-express`, `MONGO_URI` in the ConfigMap), while the repo has moved to
  **Postgres** (`manifests/deployment-postgres.yaml`, `docker-compose.yml`, `game-api/.env`).
  The current `manifests/` folder has no mongo manifests left, but `.gitlab-ci.yml` still
  `kubectl apply`s `deployment-mongo-express.yaml` / `deployment-mongodb.yaml` /
  `ingress-mongo-express.yaml`, which no longer exist in the repo — that deploy job is already
  broken for anyone who re-triggers it.
- Secrets (`ADMIN_KEY`, `SECRET_KEY`, API keys) are stored in a plain **ConfigMap**
  (`mlops-game-api-config`), not a Secret — readable in cleartext by anything with read access
  to the namespace.
- The namespace `ma-bela-veltrup` belongs to another student's thesis (it also runs their
  mongo-express admin UI, publicly ingress-exposed) — this project is a guest there.

None of this blocks day-to-day work (tests run via Docker Compose), but it means "redeploy to
k8s" today would deploy a half-dead config. This plan starts clean in a new namespace instead of
patching the old one in place.

## Decisions made with the user

- New namespace: **`mlops-lab`**. New ingress paths: **`/mlops-lab/`** (UI) and
  **`/mlops-lab-api/`** (API) — reusing the *current* path names, since they move here.
- Old namespace `ma-bela-veltrup` **keeps running untouched** (mongo stack, old images,
  ConfigMap) as a frozen snapshot — only its ingress paths are renamed to **`/mlops-thesis/`**
  and **`/mlops-thesis-api/`** to free up the nicer names and make it clear it's the legacy
  deployment. It is deployed from a different repo (not this one) and stays that way — we only
  touch its ingress, nothing else, and never route its deploys through this repo's CI.
- **Deployment to `mlops-lab` is manual, not CI-driven.** The user sets up the namespace once by
  running `kubectl apply` locally against the manifests in this repo. This repo's CI keeps
  building/testing/pushing images to the registry on every merge to `main` (unchanged — that
  part already works), but nothing in CI applies manifests or restarts pods in `mlops-lab`.
  `.gitlab-ci.yml`'s existing `deploy-game-to-k8s` job (which targets `ma-bela-veltrup` and
  references manifest files that no longer exist in the repo) is removed rather than repointed —
  it was never actually deploying this repo's current architecture correctly, and per the above,
  k8s deploys aren't CI's job going forward.
- Self-service updates in the admin panel = **one action: Restart & Repull.** Since CI already
  pushes a fresh `:latest` on every merge to `main`, and both Deployments already set
  `imagePullPolicy: Always`, an in-cluster rollout restart is sufficient to pick up both a new
  image *and* changed Secret/ConfigMap values — no GitLab API call, no trigger token, no
  additional credential to protect.
- Deployment secrets live in a **separate env file**, not `game-api/.env` (which stays
  dev-only): `game-api/.env.deploy` (gitignored, real values) with a committed
  `game-api/.env.deploy.example` template. It's consumed once, locally, as
  `kubectl create secret generic mlops-game-api-secrets --from-env-file=game-api/.env.deploy
  -n mlops-lab`. No CI/CD variable plumbing needed since there's no CI deploy step.
- No data migration: Postgres in `mlops-lab` starts empty. The old mongo data stays in
  `ma-bela-veltrup`, untouched and orphaned.

## Open items

1. **`regcred` image-pull secret.** Needs to exist in `mlops-lab` too (copy, not recreate from
   scratch — same registry credentials). Since setup is manual/local now, this is just another
   `kubectl` step the user runs once, not a CI permissions question.

### TLS — resolved, no action needed

Checked whether `wildcard-tls-secret-public` (named by both existing ingresses) could be copied
from another namespace: `disco-ml`, despite its ingress referencing that same secret name, does
**not** have it either (`kubectl get secrets -n disco-ml` shows only `regcred`) — neither does
`ma-bela-veltrup`. Yet `openssl s_client -connect public.cluster.dbis.rwth-aachen.de:443` returns
a real, currently-valid cert (issued by GEANT/RWTH, expires 2027-03-20). The ingress controller's
own ConfigMap and container args show no `default-ssl-certificate` override we have visibility
into either. Conclusion: TLS for this shared host is terminated/backed centrally by
i5/infrastructure in a way that doesn't depend on the per-namespace secret actually resolving —
every ingress just conventionally names `wildcard-tls-secret-public` regardless. Our new ingress
manifests do the same; there is nothing to request or copy.

## Step 1 — a separate deployment env file

- `game-api/.env.deploy.example` (committed) — same shape as `.env`'s secret-bearing keys, blank
  values, a comment pointing at this plan for how it's consumed.
- `game-api/.env.deploy` (real values, **gitignored** — add a `.env.deploy` line next to the
  existing bare `.env` entry in the root `.gitignore`, since that pattern doesn't match this
  longer name). Holds the production values for: `ADMIN_USER`, `ADMIN_KEY`, `SECRET_KEY`,
  `GROQ_API_KEY`, `OPENAI_API_KEY`, `WESTAI_API_KEY`, `MISTRAL_API_KEY`, `COMET_API_KEY`,
  `HF_TOKEN`, `SMTP_USERNAME`, `SMTP_PASSWORD`. Never leaves the user's machine except as the
  source for the one `kubectl create secret` command below.

## Step 2 — `manifests/` for the new namespace, applied manually once

- `manifests/namespace-mlops-lab.yaml` — new `Namespace: mlops-lab`.
- `manifests/configmap-game-api.yaml` → `namespace: mlops-lab`, non-sensitive values only:
  `PYTHONUNBUFFERED`, `POSTGRES_URI`/`POSTGRES_ASYNC_URI` (internal service DNS, not secret),
  feature flags (`ENABLE_GRAPH_DEBUG` etc.), `SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM_EMAIL`/
  `SMTP_USE_TLS`. No more `envsubst`/CI templating — it's applied directly, as-is.
- The Secret (`mlops-game-api-secrets`) is **not** a checked-in manifest — it's created
  imperatively from `game-api/.env.deploy` so the real values never touch a YAML file in the
  repo or its history:
  `kubectl create secret generic mlops-game-api-secrets -n mlops-lab --from-env-file=game-api/.env.deploy`
- `deployment-game-api.yaml` → `namespace: mlops-lab`, add `envFrom: - secretRef: {name:
  mlops-game-api-secrets}` alongside the existing `configMapRef`, and
  `serviceAccountName: mlops-game-api` (step 3's RBAC identity).
- `deployment-game-ui.yaml`, `deployment-postgres.yaml` → `namespace: mlops-lab`, otherwise
  unchanged (fresh PVC, no copy from the old mongo data).
- `ingress-game-api.yaml`, `ingress-game-ui.yaml` → `namespace: mlops-lab`, paths unchanged
  (`/mlops-lab-api/(.*)`, `/mlops-lab/(.*)`).
- `regcred` copied into `mlops-lab` (open item above) before any of the above `Deployment`s can pull
  images.
- Edit the *existing* `ma-bela-veltrup` ingress objects directly with `kubectl` (that namespace's
  manifests live in its own repo, not this one): change `path: /mlops-lab-api/(.*)` →
  `/mlops-thesis-api/(.*)` and `/mlops-lab/(.*)` → `/mlops-thesis/(.*)`. No image/env changes
  there.
- All of the above is run by hand, once, from a local `kubectl` session — not from CI.

## Step 3 — `.gitlab-ci.yml` cleanup

- Remove the `deploy-game-to-k8s` job entirely: it targeted `ma-bela-veltrup` (a different repo's
  concern now) using manifests (`deployment-mongo-express.yaml`, `deployment-mongodb.yaml`,
  `ingress-mongo-express.yaml`) that no longer exist in this repo, so it was already broken.
  Nothing replaces it — `mlops-lab` is never touched by this repo's CI.
- `build-game-api`, `build-game-ui`, `test-*`, `push-game-images` stay exactly as they are: CI's
  only remaining job is building, testing, and pushing `:latest` images to the registry on every
  merge to `main`. That's the thing the admin panel's restart button relies on already having
  happened.

## Step 4 — self-service "Restart & Repull" subpage

Backend (`game-api/src/mlops_serious_game/infrastructure/routes/admin_routes.py`, same
auth-gating pattern as the rest of that router):

- `POST /admin/deploy/restart` — does a rollout restart of `mlops-game-api` and
  `mlops-game-ui` by `PATCH`ing each Deployment's pod template with a
  `kubectl.kubernetes.io/restartedAt` annotation, via the in-cluster service account token
  (`/var/run/secrets/kubernetes.io/serviceaccount/token`) — no new Python dependency needed, a
  plain authenticated REST call to the API server reachable at `kubernetes.default.svc`. Because
  both Deployments already set `imagePullPolicy: Always`, this one restart both re-pulls
  whatever CI most recently pushed to `:latest` *and* reloads Secret/ConfigMap values — it
  covers every case the user described ("pull docker on a button click, and restart the
  containers... for .json/.env changes to catch").
- New RBAC, scoped tightly to `mlops-lab` only:
  - `ServiceAccount: mlops-game-api` (referenced by `deployment-game-api.yaml`'s
    `serviceAccountName`).
  - `Role: deployment-restarter` — `apiGroups: ["apps"]`, `resources: ["deployments"]`,
    `verbs: ["get", "patch"]`, restricted by `resourceNames` to just `mlops-game-api` and
    `mlops-game-ui`.
  - `RoleBinding` tying the two together. No cluster-scoped permissions, no access to any other
    namespace or resource type — the pod can only ever restart its own two Deployments.

Frontend (`game-ui/src/components/Admin.tsx` + a new subpage, `game-ui/src/services/api/
admin.ts` for the call):

- New "Deployment" admin subpage with a single **Restart & Repull** button behind a confirmation
  dialog (this briefly drops traffic to both services while pods roll), showing a short
  "restarting..." / "restarted" state.

## Risks / things to sanity-check before merging

- Confirm `imagePullPolicy: Always` (already set on both Deployments) is enough for a rollout
  restart to actually pick up a `:latest` tag that changed — it is, since the kubelet re-pulls
  on every pod (re)start with that policy, but worth a manual check after the first deploy.
- Because deploys are no longer CI-triggered, there's a manual step the user must remember after
  editing `gameConfig/*.json` or pushing code: wait for the `push-game-images` job to finish,
  *then* click Restart & Repull. Worth a one-line reminder in the admin subpage itself (e.g. link
  to the pipelines page) so it isn't tribal knowledge.
- Decide (separately, not blocking this plan) whether the old `ma-bela-veltrup` mongo stack
  should eventually be decommissioned — its mongo-express UI is public-ingress-exposed with no
  changes proposed here, and it isn't this repo's to change anyway.
