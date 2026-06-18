"""Create the supaschema paid-pack products and prices in Stripe (task M31).

Run with the Stripe agent toolkit's SDK present, e.g.:

    uv run --with stripe-agent-toolkit python scripts/stripe/create-catalog.py

Reads ``STRIPE_SECRET_KEY`` from the environment (never argv). Refuses to run
against a live key, is idempotent by product name, and prints created/skipped
ids only (no secret material). Prices are the recommended roadmap defaults
($49 per pack / $99 bundle, plus an annual bundle); confirm before using live.
"""

from __future__ import annotations

import os
import sys

import stripe

CATALOG = [
    {"amount": 4900, "metadata": {"pack": "type-contract"}, "name": "supaschema type-contract pack", "recurring": None},
    {"amount": 4900, "metadata": {"pack": "grant-drift"}, "name": "supaschema grant-drift pack", "recurring": None},
    {"amount": 9900, "metadata": {"pack": "bundle"}, "name": "supaschema pack bundle", "recurring": None},
    {"amount": 9900, "metadata": {"pack": "bundle"}, "name": "supaschema pack bundle (annual)", "recurring": "year"},
]


def main() -> int:
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        print("STRIPE_SECRET_KEY is not set", file=sys.stderr)
        return 1
    if not key.startswith("sk_test_"):
        print("refusing to run against a non-test key; this script is test-mode only", file=sys.stderr)
        return 1
    stripe.api_key = key

    existing = {product.name: product.id for product in stripe.Product.list(limit=100).auto_paging_iter()}
    for item in CATALOG:
        name = str(item["name"])
        if name in existing:
            print(f"skip (exists): {name} -> {existing[name]}")
            continue
        product = stripe.Product.create(name=name, metadata=item["metadata"])
        price_args = {"currency": "usd", "product": product.id, "unit_amount": item["amount"]}
        if item["recurring"] is not None:
            price_args["recurring"] = {"interval": item["recurring"]}
        price = stripe.Price.create(**price_args)
        print(f"created: {name} -> product={product.id} price={price.id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
