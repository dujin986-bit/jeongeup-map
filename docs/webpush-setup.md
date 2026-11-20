# 웹푸시 설정 (한 번만)

비공개 키(Private Key, WEBHOOK_SECRET)는 **저장소·채팅에 올리지 말고 Supabase Secrets 에만** 넣습니다.

1. PC 명령창: `npx web-push generate-vapid-keys` → Public Key / Private Key 가 나옵니다.
2. **Public Key만** `data.js`의 `VAPID_PUBLIC_KEY = ""` 에 넣고 올립니다(공개키라 괜찮음).
3. Supabase → SQL Editor: `sql/push_subscriptions.sql` 전체를 붙여넣고 Run.
4. Supabase → Edge Functions → 새 함수 `send-push` 만들고 `supabase/functions/send-push/index.ts` 내용 붙여넣기 → **Verify JWT 끄기** → Deploy.
5. Edge Functions → Secrets 에 5개 추가:
   - `VAPID_PUBLIC_KEY` = Public Key
   - `VAPID_PRIVATE_KEY` = Private Key
   - `VAPID_SUBJECT` = `mailto:내이메일`
   - `WEBHOOK_SECRET` = 아무 긴 글자(직접 만듦)
   - `ADMIN_EMAIL` = 관리자 이메일
6. Supabase → Database → Webhooks → Create: Table `reports`, Events `Insert`, Type `Supabase Edge Functions` → `send-push`, HTTP Headers 에 `x-webhook-secret` = 위 WEBHOOK_SECRET 값.
7. 폰: 관리자 페이지(홈 화면에 설치) → 위쪽 `🔕 알림` 누르고 허용 → `🔔 켜짐`.
8. 시험: 손님 화면에서 제보 하나 올리기 → 관리자 폰에 알림이 와야 합니다.
