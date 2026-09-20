# LemonSqueezy Checkout Architecture

## Overview

ColabWize uses LemonSqueezy (LS) for subscription payments. Checkout URLs are
generated server-side via the LemonSqueezy API and returned to the frontend
for redirect.

## Key Principle: Signed URLs Are Opaque

LemonSqueezy API-created **custom checkout URLs** are cryptographically signed.
The signature is embedded directly in the URL:

```
https://store.colabwize.com/checkout/custom/<UUID>?signature=<HMAC>
```

**The URL returned by the LemonSqueezy API must be used exactly as returned.**
Any modification — appending query parameters, changing encoding, reconstructing
the URL — invalidates the embedded signature and causes LemonSqueezy to reject
the request with "Invalid signature."

## Checkout Flow

```
Frontend                    Backend              LemonSqueezy API
   │                          │                         │
   │ 1. User clicks checkout  │                         │
   │    (e.g. /colab60 →      │                         │
   │     Pricing → Checkout)  │                         │
   │                          │                         │
   │ 2. GET/POST /api/subscription/checkout        │
   │ ----------------------→ │                         │
   │                          │ 3. POST /v1/checkouts   │
   │                          │    with:              │
   │                          │    checkout_data: {    │
   │                          │      discount_code    │
   │                          │      (if promo)        │
   │                          │    }                   │
   │                          │ ---------------------→│
   │                          │                         │
   │                          │ 4. 201 Created          │
   │                          │    data.attributes.url  │
   │                          │ ←────────────────←──────│
   │                          │                         │
   │ 5. Response:             │                         │
   │    {                     │                         │
   │      checkoutUrl:        │                         │
   │        "<signed URL>"    │                         │
   │    }                     │                         │
   │ ←──────────────────────  │                         │
   │                          │                         │
   │ 6. window.location.href  │                         │
   │    = checkoutUrl         │                         │
   │    (exact, unmodified)   │                         │
   └──────────────────────────┴─────────────────────────┘
```

## Discount Codes

### Correct Way: `checkout_data.discount_code`

Discount codes must be supplied during checkout **creation** via the
`checkout_data.discount_code` field in the LemonSqueezy API request body.

```json
{
  "data": {
    "type": "checkouts",
    "attributes": {
      "checkout_data": {
        "email": "user@example.com",
        "discount_code": "COLAB60",
        "custom": { "user_id": "..." }
      }
    }
  }
}
```

### NEVER: Appending to the Signed URL

Do NOT do this:

```typescript
// ❌ WRONG — invalidates the signature
const parsed = new URL(signedUrl);
parsed.searchParams.set("discount", "COLAB60");
const finalUrl = parsed.toString();
```

This produces:
```
...&discount=COLAB60
```

LemonSqueezy will reject this with "Invalid signature." because the signature
was computed over the original URL without the `discount` parameter.

## Components

### Backend

| File | Responsibility |
|---|---|
| `src/services/lemonSqueezyService.ts` | `createCheckout()` — sends POST to `/v1/checkouts` with `checkout_data.discount_code`. Returns the signed URL exactly as received. |
| `src/api/subscription/index.ts` | `POST /api/subscription/checkout` route — validates promo code format, calls `LemonSqueezyService.createCheckout()`, returns `{ checkoutUrl }`. Does NOT modify the URL. |

### Frontend

| File | Responsibility |
|---|---|
| `src/services/subscriptionService.ts` | `createCheckout()` — calls backend API, returns `response.checkoutUrl`. No URL manipulation. |
| `src/pages/PricingPage.tsx` | Triggers checkout via `SubscriptionService.createCheckout()`. Redirect: `window.location.href = checkoutUrl`. |
| `src/pages/auth/SignupPage.tsx` | Same pattern — redirects to returned URL without modification. |
| `src/pages/dashboard/CreditsPage.tsx` | Same pattern for credit purchase checkflows. |

## Campaign Route vs Discount Code

| Concept | Value | Where it lives |
|---|---|---|
| Campaign route | `/colab60` | ColabWize application (frontend route) |
| Discount code | `COLAB60` | LemonSqueezy dashboard (payment provider) |

These are related but separate:
- `/colab60` is a ColabWize marketing route directing users to the campaign.
- `COLAB60` is a LemonSqueezy discount applied at checkout via `checkout_data.discount_code`.

The `/colab60` route should **never** attempt to manipulate LemonSqueezy checkout
URLs. It only triggers the checkout flow, which passes the discount code through
the proper API channel.

## Error Handling

If the LemonSqueezy API response is malformed (no URL, non-HTTPS URL), the
backend throws an application error and returns a 500 to the frontend. The
frontend surfaces a user-friendly error message. No fallback URL is fabricated.

## Testing

| Test File | What it verifies |
|---|---|
| `test/checkout-url-passthrough.test.ts` | Signed URL returned unchanged, discount via `checkout_data`, error on malformed response |
| `test/referral.colab60.integration.test.ts` | COLAB60 + referral reward coexist independently |
