"""Pure financial engines — no FastAPI or DB imports allowed here.

Planned modules (see docs/design/design-handoff.md, "Key Computations"):
    guardrails.py — Guyton-Klinger withdrawal-rate bands
    sourcing.py   — tax-aware withdrawal sequencing waterfall
    forecast.py   — year-by-year longevity simulation
    notes.py      — auto-derived fund/goal notes
"""
