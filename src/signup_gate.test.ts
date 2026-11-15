import test from "node:test";
import assert from "node:assert/strict";
import { decideSignup } from "./signup_gate.ts";

test("a passing but review-range captcha sends the signup to review", () => {
  const decision = decideSignup(0.76);
  assert.deepEqual(decision, { status: "review", reason: "verification" });
});

test("a weak captcha rejects before a risk decision can admit the signup", () => {
  assert.deepEqual(decideSignup(0.2), { status: "rejected", reason: "captcha" });
});
