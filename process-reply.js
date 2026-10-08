// =====================================================================
//  Process Reply — يقرأ رد Gemini، يحدّث الذاكرة، ويجهّز رسالة واتساب
// =====================================================================

const FALLBACK = 'عذراً، صار عندنا خلل تقني بسيط 🙏 رح يتواصل معك أحد موظفينا قريباً.\nSorry, we had a small technical issue. A team member will contact you shortly.';
const MAX_WA_LEN = 4000; // حد واتساب للرسالة النصية 4096

const store = $getWorkflowStaticData('global');
store.chats = store.chats || {};

const parsed = $('Parse Message').all();
const out = [];

$input.all().forEach((item, i) => {
  const src = parsed[i].json;
  const res = item.json || {};
  const cfg = src.cfg;

  // نص رد Gemini (أو fallback إذا الـ API رجّع خطأ أو رد فاضي)
  let text = '';
  const parts = (res.candidates && res.candidates[0] && res.candidates[0].content && res.candidates[0].content.parts) || [];
  text = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
  const apiFailed = !text || !!res.error;

  let handoff = apiFailed || /\[HANDOFF\]/i.test(text);
  let reply = apiFailed ? FALLBACK : text.replace(/\[HANDOFF\]/gi, '').trim();
  if (!reply) reply = FALLBACK;
  if (reply.length > MAX_WA_LEN) reply = reply.slice(0, MAX_WA_LEN - 1) + '…';

  // نحفظ المحادثة بس إذا الـ AI رد صح (عشان ما نخرب ترتيب user/assistant)
  if (!apiFailed) {
    const prev = (store.chats[src.from] && store.chats[src.from].messages) || [];
    const updated = [...prev, { role: 'user', content: src.userText }, { role: 'assistant', content: reply }];
    store.chats[src.from] = {
      messages: updated.slice(-(cfg.HISTORY_TURNS * 2)),
      updatedAt: Date.now(),
    };
  }

  // تنظيف: نمسح المحادثات الأقدم من 24 ساعة
  const DAY = 24 * 60 * 60 * 1000;
  for (const [k, v] of Object.entries(store.chats)) {
    if (!v.updatedAt || Date.now() - v.updatedAt > DAY) delete store.chats[k];
  }

  const staffText =
    `🔔 تحويل لموظف\n` +
    `الزبون: ${src.name || 'بدون اسم'} (+${src.from})\n` +
    `رسالته: ${src.userText.slice(0, 500)}` +
    (apiFailed ? `\n⚠️ سبب التحويل: خطأ بالـ AI API` : '');

  out.push({
    json: {
      to: src.from,
      reply,
      handoff,
      apiFailed,
      cfg,
      sendRequest: {
        messaging_product: 'whatsapp',
        to: src.from,
        type: 'text',
        text: { preview_url: false, body: reply },
      },
      staffRequest: {
        messaging_product: 'whatsapp',
        to: cfg.STAFF_NUMBER,
        type: 'text',
        text: { preview_url: false, body: staffText },
      },
    },
  });
});

return out;
