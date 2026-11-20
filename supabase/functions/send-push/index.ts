// Supabase Edge Function: send-push  (웹푸시 발송)
// 비밀값은 코드에 쓰지 않고 Supabase > Edge Functions > Secrets 에만 넣습니다:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT(예: mailto:내이메일), WEBHOOK_SECRET(아무 긴 글자), ADMIN_EMAIL
// 배포 시 "Verify JWT" 는 끕니다(이 함수가 직접 확인함).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") || "").toLowerCase();
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "";
// 키에 섞인 공백·따옴표·"Private Key:" 글자·끝의 = 를 걸러서 쓴다
const cleanKey = (v: string | undefined) => (v || "").replace(/^\s*(public|private)\s*key\s*:/i, "").replace(/[\s"'`]/g, "").replace(/=+$/, "");
let vapidError = "";
try {
  webpush.setVapidDetails((Deno.env.get("VAPID_SUBJECT") || "").trim(), cleanKey(Deno.env.get("VAPID_PUBLIC_KEY")), cleanKey(Deno.env.get("VAPID_PRIVATE_KEY")));
} catch (e) {
  vapidError = String((e as Error).message || e) + " (공개키 길이 " + cleanKey(Deno.env.get("VAPID_PUBLIC_KEY")).length + ", 비공개키 길이 " + cleanKey(Deno.env.get("VAPID_PRIVATE_KEY")).length + ")";
  console.error("VAPID 설정 오류:", vapidError);
}
const db = createClient(URL_, SERVICE);

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-webhook-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const CAT: Record<string, string> = { traffic: "교통", event: "행사", wait: "웨이팅", incident: "사건사고", info: "생활정보" };

async function isAdminUser(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return !!data?.user?.email && data.user.email.toLowerCase() === ADMIN_EMAIL;
}

async function sendTo(roles: string[], msg: { title: string; body: string; url: string; tag?: string }) {
  const { data, error } = await db.from("push_subscriptions").select("endpoint,p256dh,auth").in("role", roles);
  let ok = 0, gone = 0;
  const fail: { status?: number; host: string; body: string }[] = [];
  if (error) fail.push({ host: "db", body: String(error.message) });
  await Promise.all((data || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 3600 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { gone++; await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint); }
      else {
        let host = ""; try { host = new URL(s.endpoint).host; } catch { /* */ }
        const f = { status: code, host, body: String((e as { body?: string }).body || (e as Error).message || e).slice(0, 200) };
        fail.push(f); console.error("푸시 실패:", JSON.stringify(f));
      }
    }
  }));
  return { ok, gone, subs: (data || []).length, fail };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (vapidError) return json({ error: "VAPID 키 설정 오류", detail: vapidError }, 500);
  let p: any; try { p = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const fromWebhook = !!WEBHOOK_SECRET && req.headers.get("x-webhook-secret") === WEBHOOK_SECRET;

  // 1) 새 제보 → 관리자에게 (Database Webhook: reports INSERT)
  if (p?.type === "INSERT" && p?.table === "reports") {
    if (!fromWebhook) return json({ error: "forbidden" }, 403);
    const r = p.record || {};
    const r2 = await sendTo(["admin"], { title: "📍 새 제보 " + (CAT[r.category] ? "· " + CAT[r.category] : ""), body: String(r.title || "").slice(0, 80), url: "admin.html", tag: "new-report" });
    return json(r2);
  }
  // 2) 손님 공지 → 관리자 로그인 사용자만
  if (p?.type === "broadcast") {
    if (!(await isAdminUser(req))) return json({ error: "forbidden" }, 403);
    const r2 = await sendTo(["guest", "admin"], { title: String(p.title || "정읍 지금").slice(0, 40), body: String(p.body || "").slice(0, 120), url: "./", tag: "notice" });
    return json(r2);
  }
  return json({ error: "unknown type" }, 400);
});
