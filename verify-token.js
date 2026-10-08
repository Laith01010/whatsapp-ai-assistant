// =====================================================================
//  Verify Token — Meta بتستدعي هاد مرة وحدة لما تربط الـ webhook
// =====================================================================
const VERIFY_TOKEN = 'noor-demo-verify-123'; // نفس الكلمة اللي بتحطها بإعدادات Meta

const q = $input.first().json.query || {};
const ok = q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === VERIFY_TOKEN;

return [{ json: { status: ok ? 200 : 403, body: ok ? String(q['hub.challenge']) : 'Forbidden' } }];
