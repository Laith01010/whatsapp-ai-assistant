// Simulates the n8n Code nodes outside n8n to check the logic.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = f => fs.readFileSync(path.join(__dirname, 'nodes', f), 'utf8');
const staticData = {};
const getStatic = () => staticData;

function runNode(file, inputItems, refs = {}) {
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = name => ({ all: () => refs[name] });
  const fn = new Function('$input', '$getWorkflowStaticData', '$', src(file));
  return fn($input, getStatic, $);
}

const payload = (id, msg, from = '971500000001') => ({
  json: { body: { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550000000', phone_number_id: '123' },
    contacts: [{ profile: { name: 'Ahmad' }, wa_id: from }],
    messages: [{ from, id, timestamp: '1760000000', ...msg }],
  } }] }] } },
});
const claudeOk = t => ({ json: { candidates: [{ content: { role: 'model', parts: [{ text: 'thinking...', thought: true }, { text: t }] }, finishReason: 'STOP' }] } });

let pass = 0; const ok = m => { pass++; console.log('✔', m); };

// 1) verify token
let r = runNode('verify-token.js', [{ json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'noor-demo-verify-123', 'hub.challenge': '9988' } } }]);
assert.deepStrictEqual(r[0].json, { status: 200, body: '9988' }); ok('verify: correct token returns challenge');
r = runNode('verify-token.js', [{ json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong' } } }]);
assert.strictEqual(r[0].json.status, 403); ok('verify: wrong token → 403');

// 2) text message → claude request
const p1 = runNode('parse-message.js', [payload('wamid.1', { type: 'text', text: { body: 'شو الأوراق المطلوبة؟' } })]);
assert.strictEqual(p1.length, 1);
assert.strictEqual(p1[0].json.cfg.MODEL, 'gemini-3.5-flash-lite');
assert.strictEqual(p1[0].json.aiRequest.contents.length, 1);
assert.deepStrictEqual(p1[0].json.aiRequest.contents[0], { role: 'user', parts: [{ text: 'شو الأوراق المطلوبة؟' }] });
assert.ok(p1[0].json.aiRequest.systemInstruction.parts[0].text.includes('KNOWLEDGE BASE'));
assert.ok(p1[0].json.aiRequest.systemInstruction.parts[0].text.includes('Customer WhatsApp name: Ahmad'));
ok('parse: text message builds Gemini request with KB + name');

// 3) duplicate id ignored
assert.strictEqual(runNode('parse-message.js', [payload('wamid.1', { type: 'text', text: { body: 'x' } })]).length, 0);
ok('parse: duplicate message id ignored');

// 4) status update (no messages) ignored
const status = { json: { body: { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read' }] } }] }] } } };
assert.strictEqual(runNode('parse-message.js', [status]).length, 0); ok('parse: status update ignored');

// 5) process normal reply → stores history
const pr1 = runNode('process-reply.js', [claudeOk('• جواز السفر الأصلي\n• تصريح الدخول')], { 'Parse Message': p1 });
assert.strictEqual(pr1[0].json.handoff, false);
assert.strictEqual(pr1[0].json.sendRequest.to, '971500000001');
assert.strictEqual(staticData.chats['971500000001'].messages.length, 2);
ok('process: normal reply, no handoff, history saved');

// 6) next message includes history
const p2 = runNode('parse-message.js', [payload('wamid.2', { type: 'text', text: { body: 'بدي احكي مع موظف' } })]);
assert.strictEqual(p2[0].json.aiRequest.contents.length, 3);
assert.deepStrictEqual(p2[0].json.aiRequest.contents.map(m => m.role), ['user', 'model', 'user']);
ok('parse: follow-up carries conversation history');

// 7) handoff tag stripped + staff alert
const pr2 = runNode('process-reply.js', [claudeOk('أكيد، رح يتواصل معك أحد موظفينا قريباً. [HANDOFF]')], { 'Parse Message': p2 });
assert.strictEqual(pr2[0].json.handoff, true);
assert.ok(!pr2[0].json.reply.includes('HANDOFF'));
assert.ok(pr2[0].json.staffRequest.text.body.includes('+971500000001'));
ok('process: [HANDOFF] stripped, staff alert prepared');

// 8) API error → fallback + handoff, history untouched
const before = staticData.chats['971500000001'].messages.length;
const p3 = runNode('parse-message.js', [payload('wamid.3', { type: 'text', text: { body: 'hello' } })]);
const pr3 = runNode('process-reply.js', [{ json: { error: { code: 400, message: 'API key not valid' } } }], { 'Parse Message': p3 });
assert.strictEqual(pr3[0].json.apiFailed, true);
assert.strictEqual(pr3[0].json.handoff, true);
assert.strictEqual(staticData.chats['971500000001'].messages.length, before);
ok('process: API failure → fallback reply + handoff, history not corrupted');

// 9) image message → placeholder text
const p4 = runNode('parse-message.js', [payload('wamid.4', { type: 'image', image: { id: 'm' } }, '971500000002')]);
assert.ok(p4[0].json.userText.includes('image'));
ok('parse: non-text message turned into a prompt to ask for text');

// 9b) thought parts excluded from reply
assert.ok(!pr1[0].json.reply.includes('thinking'));
ok('process: model "thought" parts never reach the customer');

// 9c) blocked / empty candidate → fallback
const p5 = runNode('parse-message.js', [payload('wamid.5', { type: 'text', text: { body: 'x' } }, '971500000009')]);
const pr5 = runNode('process-reply.js', [{ json: { candidates: [{ finishReason: 'SAFETY' }] } }], { 'Parse Message': p5 });
assert.strictEqual(pr5[0].json.apiFailed, true);
ok('process: empty/blocked Gemini response → fallback + handoff');

// 10) history trimmed to HISTORY_TURNS*2
for (let k = 0; k < 10; k++) {
  const pk = runNode('parse-message.js', [payload('wamid.t' + k, { type: 'text', text: { body: 'q' + k } }, '971500000003')]);
  runNode('process-reply.js', [claudeOk('a' + k)], { 'Parse Message': pk });
}
assert.strictEqual(staticData.chats['971500000003'].messages.length, 12);
assert.strictEqual(staticData.chats['971500000003'].messages[0].role, 'user');
ok('process: history capped at 12 messages and starts with user');

// 11) workflow JSON sanity
require('./build.js');
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'whatsapp-ai-bot.n8n.json'), 'utf8'));
const names = new Set(wf.nodes.map(n => n.name));
for (const [from, c] of Object.entries(wf.connections)) {
  assert.ok(names.has(from), 'missing ' + from);
  c.main.flat().forEach(t => assert.ok(names.has(t.node), 'missing ' + t.node));
}
wf.nodes.filter(n => n.type.endsWith('.code')).forEach(n => new Function('$input', '$getWorkflowStaticData', '$', n.parameters.jsCode));
ok('workflow: valid JSON, all connections resolve, all Code nodes compile');

console.log(`\n${pass} checks passed`);
