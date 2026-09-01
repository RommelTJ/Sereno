"""Seed data: sanitized, illustrative values from the design handoff.

Every dollar amount, balance, and quantity below is a placeholder from
docs/design/design-handoff.md — never real finances. Seeding is meant
for development databases so every screen has realistic numbers to
render: twelve months of balances for the sparkline, June 2026 budget
activity, funds, and a year of planning config.
"""

import json
import sqlite3

from sereno.db.connection import connect, db_path
from sereno.db.migrations import migrate
from sereno.money import to_cents

# (name, emoji, kind, tax_treatment, owner, is_liability, is_investable,
#  withdrawal_priority, access_age, penalty_rate). The 401(k) is yours
# and the HSA your spouse's, so a seeded database exercises the two
# ages a gate can be read against; the HSA is the fourth tier, tax-free
# and gated later than the 401(k).
ACCOUNTS = [
    ("Ethereum", "⚡", "eth", "LTCG", "joint", 0, 1, 1, None, None),
    ("VFIAX", "📈", "brokerage_fund", "LTCG", "joint", 0, 1, 2, None, None),
    ("VTIAX", "🌍", "brokerage_fund", "LTCG", "joint", 0, 1, 2, None, None),
    ("VGSH", "🏦", "brokerage_fund", "LTCG", "joint", 0, 1, 2, None, None),
    ("Retirement", "🏖️", "401k", "ORDINARY", "you", 0, 1, 3, 59.5, 0.10),
    ("HSA", "🩺", "hsa", "TAX_FREE", "spouse", 0, 1, 4, 65, None),
    ("Home", "🏠", "home", "NONE", "joint", 0, 0, None, None, None),
    ("Chase checking", "💵", "cash", "NONE", "joint", 0, 0, None, None, None),
    ("Vanguard Cash Plus", "💵", "cash_plus", "NONE", "joint", 0, 0, None, None, None),
    ("Car", "🚗", "car", "NONE", "joint", 0, 0, None, None, None),
    ("Mortgage", "🏡", "mortgage", "NONE", "joint", 1, 0, None, None, None),
]

ETH_QTY = 20
COST_BASIS = {"Ethereum": 24000, "VFIAX": 520000, "VTIAX": 200000, "VGSH": 125000}

# Monthly snapshots, oldest first. The 2026 rows come from the design
# handoff's ledger table; Jul-Dec 2025 extend its month-over-month deltas
# backward. Liability balances (Mortgage) are stored positive. The HSA's
# balance is carved out of the handoff's tax-advantaged figure rather
# than added to it, so net worth still matches the handoff exactly.
# (month, ETH $/unit, VFIAX, VTIAX, VGSH, Retirement, HSA, Home,
#  Chase checking, Vanguard Cash Plus, Car, Mortgage)
MONTHLY_BALANCES = [
    ("2025-07", 2400, 601000, 208000, 118000, 277000, 28000, 339000, 6500, 20000, 15000, 157700),
    ("2025-08", 2500, 610000, 212000, 119000, 280600, 28400, 340000, 6500, 20000, 15000, 157000),
    ("2025-09", 2600, 619000, 216000, 120000, 284200, 28800, 341000, 6500, 20000, 15000, 156300),
    ("2025-10", 2700, 628000, 220000, 121000, 287700, 29300, 342000, 6500, 20000, 15000, 155600),
    ("2025-11", 2800, 637000, 224000, 122000, 291300, 29700, 343000, 6500, 20000, 15000, 154900),
    ("2025-12", 2900, 646000, 228000, 123000, 294800, 30200, 344000, 6500, 20000, 15000, 154200),
    ("2026-01", 3000, 655000, 232000, 124000, 298400, 30600, 345000, 6500, 20000, 15000, 153500),
    ("2026-02", 3100, 666000, 236000, 125000, 301900, 31100, 346000, 8000, 20000, 15000, 152800),
    ("2026-03", 3200, 675000, 240000, 126000, 305500, 31500, 347000, 6000, 20000, 15000, 152100),
    ("2026-04", 3300, 682000, 243000, 127000, 309000, 32000, 348000, 9000, 20000, 15000, 151400),
    ("2026-05", 3400, 690000, 246000, 128000, 312500, 32500, 349000, 7000, 20000, 15000, 150700),
    ("2026-06", 3500, 700000, 250000, 130000, 317000, 33000, 350000, 9000, 20000, 15000, 150000),
]
USD_ACCOUNTS = (
    "VFIAX",
    "VTIAX",
    "VGSH",
    "Retirement",
    "HSA",
    "Home",
    "Chase checking",
    "Vanguard Cash Plus",
    "Car",
    "Mortgage",
)

# (name, emoji, planned, is_mandatory) — plans effective 2026-01. The
# mandatory rows demonstrate the budget report's can't-cut split.
CATEGORIES = [
    ("Groceries", "🛒", 500, 1),
    ("Gas", "🛢️", 100, 1),
    ("Entertainment", "🤪", 500, 0),
    ("Vices", "🍻", 250, 0),
    ("Consumerism", "💵", 800, 0),
    ("Travel", "✈️", 100, 0),
]
PLAN_EFFECTIVE_MONTH = "2026-01"

# (name, emoji, kind, target_amount, target_date, monthly_plan, balance)
FUNDS = [
    ("Emergency fund", "🚨", "sinking", 30000, None, 500, 10000),
    ("House maintenance", "🛠️", "sinking", 30000, None, 180, 15000),
    ("1st-year fund", "🛟", "sinking", 26000, None, 2166, 26000),
    ("Pool fund", "🏊", "goal", 14000, "2027-08-01", 0, 5000),
    ("Bike fund", "🚲", "goal", 10000, "2026-07-01", 0, 10000),
]
FUND_ENTRY_DATE = "2026-06-01"

# June 2026 spending; per-category totals match the design handoff's
# envelopes (Groceries 387, Gas 64, Entertainment 528, Vices 96,
# Consumerism 455, Travel 0). The bike purchase is fund-sourced and is
# mirrored by the transfer below.
# (txn_date, budget_month, category, amount, is_fixed, funded_from, fund, note)
EXPENSES = [
    ("2026-06-05", "2026-06", None, 1200, 0, "fund", "Bike fund", "Bike gear"),
    ("2026-06-08", "2026-06", "Gas", 64, 0, "discretionary", None, None),
    ("2026-06-10", "2026-06", "Groceries", 254.82, 0, "discretionary", None, None),
    ("2026-06-12", "2026-06", "Consumerism", 455, 0, "discretionary", None, None),
    ("2026-06-14", "2026-06", "Entertainment", 499.60, 0, "discretionary", None, "Concert tickets"),
    ("2026-06-20", "2026-06", "Vices", 96, 0, "discretionary", None, None),
    ("2026-06-22", "2026-06", None, 118.21, 1, "discretionary", None, "Electric — PG&E"),
    ("2026-06-24", "2026-06", "Groceries", 132.18, 0, "discretionary", None, "Costco"),
    ("2026-06-26", "2026-06", "Entertainment", 28.40, 0, "discretionary", None, "Poke — treat"),
]

# (txn_date, budget_month, source, amount, source_label) — prepay: May
# paychecks fund June's budget, the Jun 27 paycheck funds July.
INCOME_EVENTS = [
    ("2026-05-24", "2026-06", "paycheck", 2800, "You paycheck"),
    ("2026-05-27", "2026-06", "paycheck", 2400, "Spouse paycheck"),
    ("2026-06-27", "2026-07", "paycheck", 2400, "Spouse paycheck"),
]

# (account, acquired_on, quantity, cost_basis) — open taxable lots.
TAX_LOTS = [
    ("VFIAX", "2021-03-15", 1000, 260000),
    ("VFIAX", "2023-06-01", 800, 260000),
]


def _ids_by_name(conn: sqlite3.Connection, table: str) -> dict[str, int]:
    return {row["name"]: row["id"] for row in conn.execute(f"SELECT id, name FROM {table}")}  # noqa: S608


def seed(conn: sqlite3.Connection) -> bool:
    """Populate an empty, migrated database with the illustrative data.

    Returns True after seeding. Any existing account makes this a no-op
    returning False, so re-runs — and databases holding real finances —
    are never touched.
    """
    if conn.execute("SELECT COUNT(*) FROM account").fetchone()[0] > 0:
        return False
    conn.executemany(
        "INSERT INTO account (name, emoji, kind, tax_treatment, owner, is_liability,"
        " is_investable, withdrawal_priority, access_age, penalty_rate)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ACCOUNTS,
    )
    accounts = _ids_by_name(conn, "account")

    # balance_usd is stored in cents (quantity, price, and basis stay
    # fractional dollars), like every ledger-money column since 0013.
    balance_rows = []
    for month, eth_price, *usd_balances in MONTHLY_BALANCES:
        as_of = f"{month}-01"
        balance_rows.append(
            (
                accounts["Ethereum"],
                as_of,
                round(ETH_QTY * eth_price * 100),
                ETH_QTY,
                eth_price,
                COST_BASIS["Ethereum"],
                "manual",
            )
        )
        for name, balance in zip(USD_ACCOUNTS, usd_balances, strict=True):
            source = "zillow" if name == "Home" else "manual"
            balance_rows.append(
                (accounts[name], as_of, to_cents(balance), None, None, COST_BASIS.get(name), source)
            )
    conn.executemany(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd,"
        " quantity, unit_price, cost_basis, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
        balance_rows,
    )

    conn.executemany(
        "INSERT INTO tax_lot (account_id, acquired_on, quantity, cost_basis) VALUES (?, ?, ?, ?)",
        [(accounts[name], acquired, qty, basis) for name, acquired, qty, basis in TAX_LOTS],
    )

    conn.executemany(
        "INSERT INTO category (name, emoji, is_mandatory) VALUES (?, ?, ?)",
        [(name, emoji, mandatory) for name, emoji, _, mandatory in CATEGORIES],
    )
    categories = _ids_by_name(conn, "category")
    conn.executemany(
        "INSERT INTO category_plan (category_id, effective_month, planned) VALUES (?, ?, ?)",
        [
            (categories[name], PLAN_EFFECTIVE_MONTH, to_cents(planned))
            for name, _, planned, _ in CATEGORIES
        ],
    )

    conn.executemany(
        "INSERT INTO fund (name, emoji, kind, target_amount, target_date, monthly_plan)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        [
            (name, emoji, kind, to_cents(target), date, to_cents(monthly))
            for name, emoji, kind, target, date, monthly, _ in FUNDS
        ],
    )
    funds = _ids_by_name(conn, "fund")
    conn.executemany(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution) VALUES (?, ?, ?, ?)",
        [
            (funds[name], FUND_ENTRY_DATE, to_cents(balance), to_cents(monthly))
            for name, _, _, _, _, monthly, balance in FUNDS
        ],
    )

    fund_expense_id = None
    for txn_date, budget_month, category, amount, is_fixed, funded_from, fund, note in EXPENSES:
        cursor = conn.execute(
            "INSERT INTO expense_line (txn_date, budget_month, category_id, amount,"
            " is_fixed, funded_from, fund_id, account_id, note)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                txn_date,
                budget_month,
                categories[category] if category else None,
                to_cents(amount),
                is_fixed,
                funded_from,
                funds[fund] if fund else None,
                accounts["Chase checking"],
                note,
            ),
        )
        if funded_from == "fund":
            fund_expense_id = cursor.lastrowid

    conn.executemany(
        "INSERT INTO income_event (txn_date, budget_month, source, amount,"
        " tax_treatment, source_label) VALUES (?, ?, ?, ?, 'ORDINARY', ?)",
        [
            (txn_date, budget_month, source, to_cents(amount), source_label)
            for txn_date, budget_month, source, amount, source_label in INCOME_EVENTS
        ],
    )

    # The fund-sourced bike purchase draws down Cash Plus alongside the fund.
    conn.execute(
        "INSERT INTO transfer (txn_date, from_account, to_account, amount,"
        " linked_expense, note) VALUES (?, ?, ?, ?, ?, ?)",
        (
            "2026-06-05",
            accounts["Vanguard Cash Plus"],
            accounts["Chase checking"],
            1200,
            fund_expense_id,
            "Backs the Bike fund purchase",
        ),
    )

    # The staking yield is an illustrative round figure, like every other
    # number seeded here — a real one belongs in the deployment's database.
    conn.execute(
        "INSERT INTO assumption"
        " (effective_date, return_pct, inflation_pct, eth_growth_pct, staking_yield_pct)"
        " VALUES ('2026-01-01', 7.0, 3.0, NULL, 3.0)"
    )
    conn.execute(
        "INSERT INTO spend_plan (effective_date, annual_target, initial_rate, guardrail_band)"
        " VALUES ('2026-01-01', 45000, 0.0294, 0.20)"
    )
    conn.executemany(
        "INSERT INTO social_security (person, effective_date, start_age, monthly_amount)"
        " VALUES (?, '2026-01-01', 67, ?)",
        [("you", 1500), ("spouse", 1400)],
    )
    # Chosen to agree with the ledger above: 3% on the $150,000 June balance
    # is $375 of interest, so $1,075 of P&I leaves the $700 of principal the
    # monthly balances actually step down by.
    conn.execute(
        "INSERT INTO mortgage (effective_date, account_id, annual_rate, monthly_pi,"
        " monthly_extra, monthly_escrow) VALUES ('2026-01-01', ?, 0.03, 1075, 200, 450)",
        (accounts["Mortgage"],),
    )
    # An illustrative spend band schedule around the 45,000 plan: a
    # step up through the peak travel years, then an open-ended step
    # down once the mortgage is gone. Placeholder figures, like every
    # other seeded number.
    version = conn.execute(
        "INSERT INTO spend_band_version (effective_date) VALUES ('2026-01-01')"
    ).lastrowid
    conn.executemany(
        "INSERT INTO spend_band (version_id, start_year, end_year, annual_amount, note)"
        " VALUES (?, ?, ?, ?, ?)",
        [
            (version, 2030, 2044, 55000, "peak travel years"),
            (version, 2045, None, 38000, "slower years, mortgage gone"),
        ],
    )
    brackets = json.dumps(
        [
            {"rate": 0.10, "upto": 24800},
            {"rate": 0.12, "upto": 100800},
            {"rate": 0.22, "upto": 211400},
            {"rate": 0.24, "upto": None},
        ]
    )
    conn.execute(
        "INSERT INTO tax_param (tax_year, filing_status, ltcg_0_ceiling, ltcg_15_ceiling,"
        " niit_rate, niit_threshold, state_treatment, std_deduction, ordinary_brackets)"
        " VALUES (2026, 'MFJ', 96700, 600050, 0.038, 250000, 'CA_ordinary', 30000, ?)",
        (brackets,),
    )

    conn.commit()
    return True


def main() -> None:
    """Migrate and seed the database at SERENO_DB_PATH (the Docker volume)."""
    conn = connect()
    try:
        migrate(conn)
        if seed(conn):
            print(f"Seeded {db_path()} with the illustrative design-handoff data.")
        else:
            print(f"{db_path()} already has data; nothing seeded.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
