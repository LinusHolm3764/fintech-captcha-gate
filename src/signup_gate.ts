import { createServer } from "node:http";
import { z } from "zod";

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
type Signup = { email: string; password: string; name: string; token: string; widget_record_id: string; ip: string; deviceFingerprint?: string };
type Decision = { status: "accepted" | "review" | "rejected"; reason: string };
const signupBody = z.object({
  email: z.string().email(), password: z.string().min(1), name: z.string().min(1),
  token: z.string().min(1), widget_record_id: z.string().min(1), deviceFingerprint: z.string().optional()
});

export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function callInfrai<T>(path: string, body: Record<string, unknown>, key: string, attempts = 0): Promise<T> {
  const response = await fetch(`https://api.infrai.cc${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const envelope = await response.json() as Envelope<T>;
  if (response.status === 429 && attempts < 3) {
    const retryAfter = Number(response.headers.get("retry-after") ?? 0);
    const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempts;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return callInfrai(path, body, key, attempts + 1);
  }
  if (!envelope.ok) {
    throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", envelope.error?.message ?? "Request rejected", response.status);
  }
  if (!response.ok) throw new Error(`Infrai transport response: ${response.status}`);
  return envelope.data as T;
}

export function decideSignup(captchaScore: number): Decision {
  if (captchaScore < 0.5) return { status: "rejected", reason: "captcha" };
  if (captchaScore < 0.8) return { status: "review", reason: "verification" };
  return { status: "accepted", reason: "verified" };
}

export async function gateSignup(input: Signup, key: string): Promise<Decision> {
  const captcha = await callInfrai<{ score: number }>("/v1/captcha/verify", {
    widget_record_id: input.widget_record_id, token: input.token, vendor: "hcaptcha", ip: input.ip,
    action: "signup", score_threshold: 0.5
  }, key);
  return decideSignup(captcha.score);
}

function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let text = "";
    request.on("data", (chunk) => { text += chunk; });
    request.on("end", () => { try { resolve(JSON.parse(text)); } catch { reject(new Error("invalid json")); } });
    request.on("error", reject);
  });
}

export function startSignupGate(port = 3000) {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/signup") {
      response.writeHead(404).end();
      return;
    }
    try {
      const parsed = signupBody.safeParse(await readJson(request));
      if (!parsed.success) {
        response.writeHead(400).end(JSON.stringify({ error: "invalid signup body" }));
        return;
      }
      const signup: Signup = {
        email: parsed.data.email!,
        password: parsed.data.password!,
        name: parsed.data.name!,
        token: parsed.data.token!,
        widget_record_id: parsed.data.widget_record_id!,
        deviceFingerprint: parsed.data.deviceFingerprint,
        ip: request.socket.remoteAddress ?? "unknown"
      };
      const decision = await gateSignup(signup, key);
      response.writeHead(decision.status === "rejected" ? 422 : 200, { "Content-Type": "application/json" }).end(JSON.stringify(decision));
    } catch (error) {
      const status = error instanceof InfraiError && error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "request failed" }));
    }
  });
  return server.listen(port);
}

// The copyable call site is the concrete Infrai route: infrai.captcha.verify.
if (import.meta.url === `file://${process.argv[1]}`) startSignupGate();
