# Security Review

## Scope

This review covers authentication and authorization, lead access, WhatsApp
messaging, payments and coupons, lead discovery, browser navigation, and
resource-exhaustion controls.

## Findings addressed

- Protected API routes reject permanently blocked users and users with an active
  temporary block.
- Unpurchased leads return preview fields only; contact details are available
  after purchase in the user's saved-lead record.
- WhatsApp messaging requires an existing purchased lead and uses its stored
  phone number rather than client-supplied recipient data.
- Coupon use is reserved transactionally while creating a payment order.
- Razorpay verification requires the payment to be captured, linked to the
  authenticated order, and equal to the expected amount.
- Discovery, WhatsApp, and payment verification have server-side rate limits.
- Discovery rejects private, loopback, link-local, metadata, and mapped private
  IP destinations before browser navigation and blocks Chromium sandbox
  disabling flags.

## Residual risk

DNS rebinding cannot be fully eliminated by application-level DNS checks when a
browser performs its own resolution. Production discovery should run in an
isolated worker or outbound proxy that enforces egress policy at the network
boundary, including redirect validation and private-address blocking.

The in-memory rate limiter is process-local. Deployments with multiple
instances should replace it with a shared store such as Redis or Firestore
transaction counters.

## Validation

- `npm run build`
- `npx tsc --noEmit`
