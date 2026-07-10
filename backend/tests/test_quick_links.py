import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "sereno.db"))
    with TestClient(app) as client:
        yield client


def create(client, label="Chase", url="https://chaseonline.chase.com/MyAccounts.aspx"):
    return client.post("/api/quick-links", json={"label": label, "url": url})


class TestGetQuickLinks:
    def test_empty_database_returns_no_links(self, client):
        response = client.get("/api/quick-links")
        assert response.status_code == 200
        assert response.json() == []

    def test_lists_links_by_sort_order_before_id(self, client):
        create(client, "Chase", "https://chase.com")
        create(client, "Vanguard", "https://vanguard.com")
        conn = connect()
        try:
            conn.execute("UPDATE quick_link SET sort_order = 3 - id")
            conn.commit()
        finally:
            conn.close()
        labels = [link["label"] for link in client.get("/api/quick-links").json()]
        assert labels == ["Vanguard", "Chase"]


class TestPostQuickLinks:
    def test_creates_a_link_and_echoes_it(self, client):
        response = create(client)
        assert response.status_code == 201
        body = response.json()
        assert set(body) == {"id", "label", "url"}
        assert body["label"] == "Chase"
        assert body["url"] == "https://chaseonline.chase.com/MyAccounts.aspx"

    def test_new_links_list_in_creation_order(self, client):
        create(client, "Chase", "https://chase.com")
        create(client, "Vanguard", "https://vanguard.com")
        labels = [link["label"] for link in client.get("/api/quick-links").json()]
        assert labels == ["Chase", "Vanguard"]

    def test_a_schemeless_url_gets_https_prefixed(self, client):
        # The path and query survive verbatim — only the missing scheme is
        # filled in, so the link resolves absolutely instead of relative to
        # the app.
        response = create(client, "Chase", "chaseonline.chase.com/MyAccounts.aspx")
        assert response.json()["url"] == "https://chaseonline.chase.com/MyAccounts.aspx"

    def test_an_http_url_is_kept_verbatim(self, client):
        response = create(client, "Router", "http://192.168.1.1/status")
        assert response.json()["url"] == "http://192.168.1.1/status"

    def test_blank_label_or_url_is_rejected(self, client):
        assert create(client, "  ", "https://chase.com").status_code == 422
        assert create(client, "Chase", "  ").status_code == 422
