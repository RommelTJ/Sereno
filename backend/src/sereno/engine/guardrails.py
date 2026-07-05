"""Guyton-Klinger guardrails: the ±band around the stored at-retirement
rate is the trigger, the ~10% spending adjustment is the response — never
a reset back to the band. Ported from the design handoff's guardrail
rules. Pure math over the caller's numbers; fetching balances and config
is the API layer's job, which also guards investable > 0.
"""

from dataclasses import dataclass
from typing import Literal

Zone = Literal["cut", "hold", "raise"]


@dataclass(frozen=True)
class GuardrailDecision:
    rate: float
    lower: float
    upper: float
    zone: Zone
    raise_trigger: float
    cut_trigger: float


def evaluate_guardrails(
    *,
    spend: float,
    investable: float,
    initial_rate: float,
    band: float,
) -> GuardrailDecision:
    rate = spend / investable
    lower = initial_rate * (1 - band)
    upper = initial_rate * (1 + band)
    zone: Zone = "cut" if rate > upper else "raise" if rate < lower else "hold"
    return GuardrailDecision(
        rate=rate,
        lower=lower,
        upper=upper,
        zone=zone,
        raise_trigger=spend / lower,
        cut_trigger=spend / upper,
    )
