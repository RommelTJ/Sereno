import pytest

from sereno.db.connection import connect
from sereno.db.migrations import migrate
from sereno.db.seed import main, seed
from sereno.money import to_dollars

ALL_TABLES = [
    "account",
    "fund",
    "category",
    "category_plan",
    "balance_entry",
    "tax_lot",
    "expense_line",
    "income_event",
    "fund_entry",
    "transfer",
    "assumption",
    "spend_plan",
    "social_security",
    "tax_param",
    "mortgage",
    "spend_band_version",
    "spend_band",
]


@pytest.fixture
def db(tmp_path):
    conn = connect(tmp_path / "sereno.db")
    migrate(conn)
    yield conn
    conn.close()


class TestSeedPopulatesEveryTable:
    @pytest.mark.parametrize("table", ALL_TABLES)
    def test_every_table_has_rows(self, db, table):
        seed(db)
        count = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608
        assert count > 0, f"{table} was not seeded"

    def test_seeds_the_ten_design_handoff_accounts(self, db):
        seed(db)
        names = {row["name"] for row in db.execute("SELECT name FROM account")}
        assert names == {
            "Ethereum",
            "VFIAX",
            "VTIAX",
            "VGSH",
            "Retirement",
            "Home",
            "Chase checking",
            "Vanguard Cash Plus",
            "Car",
            "Mortgage",
        }

    def test_seeds_an_emoji_per_account(self, db):
        seed(db)
        rows = db.execute("SELECT name, emoji FROM account")
        emojis = {row["name"]: row["emoji"] for row in rows}
        assert emojis == {
            "Ethereum": "⚡",
            "VFIAX": "📈",
            "VTIAX": "🌍",
            "VGSH": "🏦",
            "Retirement": "🏖️",
            "Home": "🏠",
            "Chase checking": "💵",
            "Vanguard Cash Plus": "💵",
            "Car": "🚗",
            "Mortgage": "🏡",
        }

    def test_seeds_an_emoji_per_fund(self, db):
        seed(db)
        rows = db.execute("SELECT name, emoji FROM fund")
        emojis = {row["name"]: row["emoji"] for row in rows}
        assert emojis == {
            "Emergency fund": "🚨",
            "House maintenance": "🛠️",
            "1st-year fund": "🛟",
            "Pool fund": "🏊",
            "Bike fund": "🚲",
        }


class TestSeedSatisfiesTheViews:
    def test_net_worth_covers_twelve_months(self, db):
        seed(db)
        query = "SELECT month FROM v_net_worth ORDER BY month"
        months = [row["month"] for row in db.execute(query)]
        assert len(months) == 12
        assert months[0] == "2025-07"
        assert months[-1] == "2026-06"

    def test_current_month_net_worth_matches_the_design_handoff(self, db):
        seed(db)
        row = db.execute(
            "SELECT net_worth, investable FROM v_net_worth WHERE month = '2026-06'"
        ).fetchone()
        # The views sum stored cents; the handoff's figures are dollars.
        assert row["net_worth"] == 174_400_000
        assert row["investable"] == 150_000_000

    def test_budget_month_has_income_and_spend(self, db):
        seed(db)
        row = db.execute("SELECT * FROM v_budget_month WHERE month = '2026-06'").fetchone()
        assert row is not None
        assert row["funded_in"] > 0
        assert row["total_spent"] > 0

    def test_income_titles_seed_as_source_labels_not_notes(self, db):
        # The seed's income titles ("Spouse paycheck") are display titles,
        # so they belong in source_label; note stays free for a real note.
        seed(db)
        rows = db.execute("SELECT source_label, note FROM income_event ORDER BY id").fetchall()
        assert [row["source_label"] for row in rows] == [
            "You paycheck",
            "Spouse paycheck",
            "Spouse paycheck",
        ]
        assert all(row["note"] is None for row in rows)

    def test_mortgage_terms_amortize_the_seeded_balance(self, db):
        # The seeded terms are not free-floating placeholders: the P&I has
        # to explain the ledger's own mortgage paydown, or the payoff the
        # Plan screen shows would contradict the balances beside it. The
        # June 2026 balance is $150,000 and each month knocks off $700, so
        # 3% on $150,000 leaves $375 of interest and $700 of principal.
        seed(db)
        row = db.execute(
            "SELECT m.annual_rate, m.monthly_pi, m.monthly_extra, m.monthly_escrow,"
            " b.balance_usd FROM mortgage m"
            " JOIN account a ON a.id = m.account_id"
            " JOIN balance_entry b ON b.account_id = a.id AND b.as_of_date = '2026-06-01'"
        ).fetchone()
        assert row is not None, "the seeded terms must link the Mortgage account"
        assert row["balance_usd"] == 15_000_000
        monthly_interest = to_dollars(row["balance_usd"]) * row["annual_rate"] / 12
        assert monthly_interest == pytest.approx(375)
        assert row["monthly_pi"] - monthly_interest == pytest.approx(700)
        assert row["monthly_extra"] > 0
        assert row["monthly_escrow"] > 0

    def test_spend_bands_step_around_the_flat_target(self, db):
        # The seeded schedule is a coherent story against the 45,000
        # plan: a step up through the peak years, then an open-ended
        # step down — non-overlapping, noted, and never the flat
        # target itself, or the seed would demo nothing.
        seed(db)
        rows = db.execute(
            "SELECT b.start_year, b.end_year, b.annual_amount, b.note FROM spend_band b"
            " JOIN spend_band_version v ON v.id = b.version_id ORDER BY b.start_year"
        ).fetchall()
        assert len(rows) >= 2
        target = db.execute("SELECT annual_target FROM spend_plan").fetchone()[0]
        previous_end = None
        for row in rows:
            assert row["note"], "every seeded band carries its rationale"
            assert row["annual_amount"] != target
            if previous_end is not None:
                assert row["start_year"] > previous_end
            previous_end = row["end_year"]
        assert rows[-1]["end_year"] is None, "the last band is open-ended"

    def test_eth_balances_are_quantity_times_price(self, db):
        seed(db)
        rows = db.execute(
            "SELECT b.balance_usd, b.quantity, b.unit_price FROM balance_entry b"
            " JOIN account a ON a.id = b.account_id WHERE a.kind = 'eth'"
        ).fetchall()
        assert rows
        for row in rows:
            assert row["balance_usd"] == round(row["quantity"] * row["unit_price"] * 100)


def table_counts(db):
    return {
        table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608
        for table in ALL_TABLES
    }


class TestSeedIsIdempotent:
    def test_first_run_seeds_and_reports_it(self, db):
        assert seed(db) is True

    def test_second_run_is_a_noop(self, db):
        seed(db)
        counts = table_counts(db)
        assert seed(db) is False
        assert table_counts(db) == counts

    def test_any_existing_account_blocks_seeding(self, db):
        # Real deployments have real accounts; seeding must never touch them.
        db.execute("INSERT INTO account (name, kind) VALUES ('My real checking', 'cash')")
        db.commit()
        assert seed(db) is False
        assert table_counts(db) == dict.fromkeys(ALL_TABLES, 0) | {"account": 1}


class TestMain:
    def test_migrates_and_seeds_a_fresh_database(self, monkeypatch, tmp_path, capsys):
        db_file = tmp_path / "sereno.db"
        monkeypatch.setenv("SERENO_DB_PATH", str(db_file))
        main()
        assert db_file.exists()
        assert "seeded" in capsys.readouterr().out.lower()
        conn = connect(db_file)
        try:
            assert conn.execute("SELECT COUNT(*) FROM account").fetchone()[0] == 10
        finally:
            conn.close()

    def test_second_run_is_a_noop(self, monkeypatch, tmp_path, capsys):
        monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "sereno.db"))
        main()
        capsys.readouterr()
        main()
        assert "already has data" in capsys.readouterr().out
