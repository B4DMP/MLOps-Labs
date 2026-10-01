"""In-cluster rollout restart for the admin panel's "Restart & Repull" button.

Both Deployments run with `imagePullPolicy: Always`, so a rollout restart is enough to pick
up whatever image CI most recently pushed to `:latest`, plus any changed Secret/ConfigMap
values. Talks to the k8s API server directly over the in-cluster service account token
(`manifests/rbac-game-api.yaml` scopes it to `get`/`patch` on just these two Deployments) -
no `kubectl` binary or extra Python dependency needed.
"""

from datetime import datetime, timezone
from pathlib import Path

import httpx

_SA_DIR = Path("/var/run/secrets/kubernetes.io/serviceaccount")
_DEPLOYMENTS = ["mlops-game-api", "mlops-game-ui"]
_K8S_API_HOST = "https://kubernetes.default.svc"


class NotInClusterError(RuntimeError):
    """Raised when the service account files that only exist inside a pod are missing."""


def _read_in_cluster_credentials() -> tuple[str, str, Path]:
    token_path = _SA_DIR / "token"
    ca_path = _SA_DIR / "ca.crt"
    namespace_path = _SA_DIR / "namespace"
    if not (token_path.exists() and ca_path.exists() and namespace_path.exists()):
        raise NotInClusterError(
            "Not running inside a Kubernetes pod (no service account credentials found) - "
            "the restart/repull action only works in the deployed cluster."
        )
    token = token_path.read_text().strip()
    namespace = namespace_path.read_text().strip()
    return token, namespace, ca_path


async def restart_deployments() -> list[dict]:
    """Rollout-restart every game Deployment. Returns one result dict per deployment."""
    token, namespace, ca_path = _read_in_cluster_credentials()
    restarted_at = datetime.now(timezone.utc).isoformat()
    patch_body = {
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {"kubectl.kubernetes.io/restartedAt": restarted_at}
                }
            }
        }
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/strategic-merge-patch+json",
    }

    results = []
    async with httpx.AsyncClient(verify=str(ca_path), timeout=10.0) as client:
        for name in _DEPLOYMENTS:
            url = (
                f"{_K8S_API_HOST}/apis/apps/v1/namespaces/{namespace}/deployments/{name}"
            )
            response = await client.patch(url, json=patch_body, headers=headers)
            response.raise_for_status()
            results.append({"deployment": name, "restarted_at": restarted_at})
    return results
