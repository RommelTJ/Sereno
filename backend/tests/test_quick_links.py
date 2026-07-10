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


class TestPutQuickLink:
    def test_revises_label_and_url_in_place(self, client):
        link_id = create(client).json()["id"]
        response = client.put(
            f"/api/quick-links/{link_id}",
            json={"label": "Chase checking", "url": "https://chase.com/login"},
        )
        assert response.status_code == 200
        assert response.json() == {
            "id": link_id,
            "label": "Chase checking",
            "url": "https://chase.com/login",
        }
        assert client.get("/api/quick-links").json() == [response.json()]

    def test_a_schemeless_url_gets_https_prefixed(self, client):
        link_id = create(client).json()["id"]
        response = client.put(
            f"/api/quick-links/{link_id}",
            json={"label": "Chase", "url": "chase.com/login"},
        )
        assert response.json()["url"] == "https://chase.com/login"

    def test_blank_label_or_url_is_rejected(self, client):
        link_id = create(client).json()["id"]
        for body in (
            {"label": "  ", "url": "https://chase.com"},
            {"label": "Chase", "url": "  "},
        ):
            assert client.put(f"/api/quick-links/{link_id}", json=body).status_code == 422

    def test_unknown_link_returns_404(self, client):
        response = client.put(
            "/api/quick-links/999", json={"label": "Chase", "url": "https://chase.com"}
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "quick link not found"


class TestReorderQuickLinks:
    def test_persists_and_echoes_the_new_order(self, client):
        chase = create(client, "Chase", "https://chase.com").json()["id"]
        vanguard = create(client, "Vanguard", "https://vanguard.com").json()["id"]
        fidelity = create(client, "Fidelity", "https://fidelity.com").json()["id"]
        response = client.put("/api/quick-links/order", json={"ids": [fidelity, chase, vanguard]})
        assert response.status_code == 200
        assert [link["label"] for link in response.json()] == [
            "Fidelity",
            "Chase",
            "Vanguard",
        ]
        labels = [link["label"] for link in client.get("/api/quick-links").json()]
        assert labels == ["Fidelity", "Chase", "Vanguard"]

    def assert_rejected(self, response):
        assert response.status_code == 422
        assert response.json()["detail"] == "ids must be exactly the quick link ids"

    def test_ids_must_cover_exactly_the_quick_links(self, client):
        chase = create(client, "Chase", "https://chase.com").json()["id"]
        vanguard = create(client, "Vanguard", "https://vanguard.com").json()["id"]
        self.assert_rejected(client.put("/api/quick-links/order", json={"ids": [chase]}))
        self.assert_rejected(
            client.put("/api/quick-links/order", json={"ids": [chase, vanguard, 999]})
        )
        self.assert_rejected(
            client.put("/api/quick-links/order", json={"ids": [chase, chase, vanguard]})
        )

    def test_new_link_lists_last_after_a_reorder(self, client):
        chase = create(client, "Chase", "https://chase.com").json()["id"]
        vanguard = create(client, "Vanguard", "https://vanguard.com").json()["id"]
        client.put("/api/quick-links/order", json={"ids": [vanguard, chase]})
        create(client, "Fidelity", "https://fidelity.com")
        labels = [link["label"] for link in client.get("/api/quick-links").json()]
        assert labels == ["Vanguard", "Chase", "Fidelity"]


class TestDeleteQuickLink:
    def test_deletes_the_row_and_keeps_the_rest_in_order(self, client):
        create(client, "Chase", "https://chase.com")
        vanguard = create(client, "Vanguard", "https://vanguard.com").json()["id"]
        create(client, "Fidelity", "https://fidelity.com")
        response = client.delete(f"/api/quick-links/{vanguard}")
        assert response.status_code == 204
        labels = [link["label"] for link in client.get("/api/quick-links").json()]
        assert labels == ["Chase", "Fidelity"]

    def test_unknown_link_returns_404(self, client):
        response = client.delete("/api/quick-links/999")
        assert response.status_code == 404
        assert response.json()["detail"] == "quick link not found"
