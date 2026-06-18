"""Create a Stripe Checkout Session for a per-repo license purchase (tasks M31/M32).

Binds the purchase to a GitHub repo via ``metadata.repo`` so the issuance Worker
(``services/license-worker``) can mint a repo-bound license on
``checkout.session.completed``. Follows Stripe best practices: Checkout Sessions
(hosted), dynamic payment methods (never pass ``payment_method_types``),
``mode="subscription"`` for the recurring annual price else ``mode="payment"``.

Run with the Stripe agent toolkit's SDK present:

    uv run --with stripe-agent-toolkit --with stripe python \
        scripts/stripe/create-checkout.py <owner/repo> [pack]

``pack`` is one of: type-contract, grant-drift, bundle (default), bundle-annual.
Reads ``STRIPE_SECRET_KEY`` from env (never argv); test-mode only.
"""

from __future__ import annotations

import os
import sys

import stripe

PACK_PRODUCTS = {
    "type-contract": "supaschema type-contract pack",
    "grant-drift": "supaschema grant-drift pack",
    "bundle": "supaschema pack bundle",
    "bundle-annual": "supaschema pack bundle (annual)",
}


def is_repo_slug(value: str) -> bool:
    parts = value.split("/")
    return len(parts) == 2 and all(
        part and all(is_repo_slug_char(char) for char in part) for part in parts
    )


def is_repo_slug_char(char: str) -> bool:
    return char.isascii() and (char.isalnum() or char in "._-")


def find_price(product_name: str) -> tuple[str, bool]:
    for product in stripe.Product.list(limit=100, active=True).auto_paging_iter():
        if product.name != product_name:
            continue
        prices = stripe.Price.list(product=product.id, active=True, limit=1).data
        if not prices:
            raise SystemExit(f"no active price for product {product_name!r}")
        price = prices[0]
        return price.id, price.recurring is not None
    raise SystemExit(f"product not found: {product_name!r} (run create-catalog.py first)")


def main(argv: list[str]) -> int:
    if len(argv) < 1 or not is_repo_slug(argv[0]):
        print("usage: create-checkout.py <owner/repo> [pack]", file=sys.stderr)
        return 2
    repo = argv[0]
    pack = argv[1] if len(argv) > 1 else "bundle"
    if pack not in PACK_PRODUCTS:
        print(f"unknown pack {pack!r}; choose from {', '.join(PACK_PRODUCTS)}", file=sys.stderr)
        return 2

    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key.startswith("sk_test_"):
        print("refusing to run without a test key (sk_test_)", file=sys.stderr)
        return 1
    stripe.api_key = key

    price_id, recurring = find_price(PACK_PRODUCTS[pack])
    session = stripe.checkout.Session.create(
        mode="subscription" if recurring else "payment",
        line_items=[{"price": price_id, "quantity": 1}],
        metadata={"plan": pack, "repo": repo},
        success_url="https://supaschema.com/license/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url="https://supaschema.com/license/cancel",
    )
    print(
        f"checkout session {session.id} for {repo} ({pack}, {'subscription' if recurring else 'payment'})"
    )
    print(session.url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
