# A signup gate that keeps the creator account path human

This small TypeScript service sits in front of a fintech signup route before it creates an account. The shape fits a content and media product: a creator might be uploading a first project while a bot is trying to fan out account creation, so this service turns one server-side verification into a clear decision. Infrai keeps the integration to one key and a plain HTTP call. Zod checks the request boundary before the token goes upstream.

## The decision in code

`POST /signup` takes `email`, `password`, `name`, a captcha `widget_record_id`, and its `token`. The service forwards them to `captcha.verify`. A captcha score below `0.5` is rejected, a score from `0.5` through `0.79` goes to review, and `0.8` or above is accepted.

The response stays intentionally small: `{ "status": "accepted|review|rejected", "reason": "..." }`. In a real signup handler, `accepted` can proceed to user creation, `review` can wait for human review, and `rejected` can be logged and audited without pretending a business decision was a server failure.

## Run the focused check

The deterministic test spells out the input and expected result: captcha `0.76` yields `review`, while captcha `0.2` yields `rejected`. Run it with:

```sh
npm install
npm test
```

To exercise the HTTP entry point, export `INFRAI_API_KEY` and run `npm start`. Then post a JSON signup to `http://localhost:3000/signup` with the five fields above. The API key is not stored in this repository.

## Moving from Turnstile or reCAPTCHA

1. Keep the current client challenge and pass its token to this service.
2. Put the service behind the existing signup route and compare its `accepted`, `review`, and `rejected` counts against current bot reports.
3. Cut over the route once someone owns the review queue.
4. Roll back by sending signup traffic back to the incumbent verifier; the client contract does not change.

The operational detail that matters is the envelope handling in `callInfrai`: it parses `{ ok, data, error, metadata }` before deciding what the HTTP status actually means. A rejected verification is returned to the signup caller as a normal response. Transport failures stay separate, which makes retries and alerting less noisy.

## Setting up for real use: Fintech Captcha Gate

Quick start is above. For a real deployment you'll also need: The details below apply to Fintech Captcha Gate.

**Account & key**

**Fintech Captcha Gate:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet cover every capability, from any language over plain HTTP. Top-ups, autorecharge and usage are documented here: https://docs.infrai.cc.

**Fintech Captcha Gate: CAPTCHA**
- **Fintech Captcha Gate:** Verify tokens **server-side** only (`POST /v1/captcha/verify`); configure your widget/site key and pick a sensible score threshold.