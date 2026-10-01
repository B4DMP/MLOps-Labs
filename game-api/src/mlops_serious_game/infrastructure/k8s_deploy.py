"""In-cluster k8s access for the admin panel's Deployment tab: restart/repull, and reading pod
logs for the "what's actually happening right now" log viewer.

Both Deployments run with `imagePullPolicy: Always`, so a rollout restart is enough to pick
up whatever image CI most recently pushed to `:latest`, plus any changed Secret/ConfigMap
values. Talks to the k8s API server directly over the in-cluster service account token
(`manifests/rbac-game-api.yaml` scopes it to exactly what's used here: get/patch on the two
Deployments, get/list on pods, get on pods/log) - no `kubectl` binary or extra Python
dependency needed.
"""

from datetime import datetime, timezone
from pathlib import Path

import httpx

_SA_DIR = Path("/var/run/secrets/kubernetes.io/serviceaccount")
_DEPLOYMENTS = ["mlops-game-api", "mlops-game-ui"]
_LOGGABLE_APPS = ["mlops-game-api", "mlops-game-ui", "mlops-game-postgres"]
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


class UnknownAppError(ValueError):
    """Raised for an app name outside the fixed allow-list - never pass user input through here."""


async def get_pod_logs(app: str, tail_lines: int = 500) -> dict:
    """Tail the current pod's container log for one of the three apps in this namespace. During
    a rollout there can briefly be two pods for the same app - picks the most recently created
    one, same as what you'd see following along with `kubectl logs` right after a restart."""
    if app not in _LOGGABLE_APPS:
        raise UnknownAppError(f"Unknown app '{app}', expected one of {_LOGGABLE_APPS}")

    token, namespace, ca_path = _read_in_cluster_credentials()
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(verify=str(ca_path), timeout=10.0) as client:
        pods_url = f"{_K8S_API_HOST}/api/v1/namespaces/{namespace}/pods"
        response = await client.get(
            pods_url, headers=headers, params={"labelSelector": f"app={app}"}
        )
        response.raise_for_status()
        pods = response.json().get("items", [])
        if not pods:
            return {"pod": None, "logs": f"No pods found for app={app}."}

        pods.sort(key=lambda p: p["metadata"]["creationTimestamp"], reverse=True)
        pod_name = pods[0]["metadata"]["name"]

        log_url = f"{_K8S_API_HOST}/api/v1/namespaces/{namespace}/pods/{pod_name}/log"
        log_response = await client.get(
            log_url,
            headers=headers,
            params={"tailLines": tail_lines, "timestamps": "true"},
        )
        log_response.raise_for_status()
        return {"pod": pod_name, "logs": log_response.text}
