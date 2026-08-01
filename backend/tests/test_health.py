from importlib.metadata import version

from fastapi.testclient import TestClient

from sereno.main import app

client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": version("sereno")}
