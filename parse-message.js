// =====================================================================
//  Parse Message — يستقبل رسالة واتساب ويجهّز الطلب لـ Gemini
// =====================================================================

// ============ CONFIG — عدّل القيم هون فقط ============
const CONFIG = {
  WHATSAPP_TOKEN: 'PUT_META_ACCESS_TOKEN_HERE',   // من Meta > WhatsApp > API Setup
  PHONE_NUMBER_ID: 'PUT_PHONE_NUMBER_ID_HERE',    // من نفس الصفحة (مش رقم التلفون نفسه)
  GRAPH_VERSION: 'v26.0',                         // نسخة Graph API (نفس النسخة اللي بإعدادات الـ Webhook بـ Meta)
  GEMINI_API_KEY: 'PUT_GEMINI_API_KEY_HERE',      // من aistudio.google.com (مجاني)
  MODEL: 'gemini-3.5-flash-lite',                 // سريع ومجاني. للجودة الأعلى: 'gemini-3.8-flash'
  STAFF_NUMBER: '9715XXXXXXXX',                   // رقم الموظف اللي بيستلم التحويلات (بدون +)
  HISTORY_TURNS: 6,                               // كم رسالة سابقة يتذكر البوت لكل زبون
};

// ============ KNOWLEDGE BASE — معلومات المركز (بيانات تجريبية) ============
// كل اللي تحت DEMO. بدّلها بمعلومات الشركة الحقيقية.
const KNOWLEDGE_BASE = `
CENTER: Noor Medical Fitness Center (DEMO / fictional)
LOCATION: Ground floor, Demo Building, Al Karama, Dubai — 3 min walk from a metro station. Parking available at the back.
WORKING HOURS: Saturday–Thursday 7:30 AM – 9:00 PM. Friday 2:00 PM – 9:00 PM.

SERVICES (residency visa medical fitness test = blood test + chest X-ray):
• Normal service: 320 AED — result within 48 hours.
• Express service: 500 AED — result within 24 hours.
• VIP service: 750 AED — same day result (if test done before 12:00 PM), private waiting area.
• Visa cancellation / renewal tests follow the same packages.

REQUIRED DOCUMENTS:
• Original passport.
• Entry permit (for new visa) or residency visa copy (for renewal).
• Emirates ID (if available).
• The application must be typed at a typing center first; bring the application number.

PAYMENT: Cash, card, and Apple Pay accepted.
APPOINTMENTS: Walk-in is accepted. Booking is not required but VIP clients can book by WhatsApp with a staff member.
RESULTS: Results are sent electronically to the immigration system and by SMS to the customer. The bot CANNOT see results or application status.
WOMEN: Separate section and female staff available.
LANGUAGES: Arabic, English, Hindi, Urdu, Tagalog spoken at the center.
`.trim();

const SYSTEM_PROMPT = `You are the WhatsApp assistant for a medical fitness center. You help customers with information about visa medical tests.

RULES:
1. Answer ONLY using the KNOWLEDGE BASE below. Never invent prices, times, documents or policies.
2. If the answer is not in the knowledge base, say a team member will help them and add [HANDOFF].
3. Reply in the same language the customer used (Arabic dialect → simple Arabic; English → English).
4. WhatsApp style: short (max ~6 lines), friendly, use "•" for lists, *single asterisks* for bold, at most one emoji. No markdown headers or tables.
5. Never give medical advice, never interpret test results, never promise a visa outcome.
6. You cannot see any customer records. For result status or application status, ask for the application number and add [HANDOFF].
7. If the customer asks for a human, complains, is upset, or wants to book VIP: apologize briefly if needed, say a team member will contact them, and add [HANDOFF].
8. If the message says the customer sent a non-text message (image, voice, file), politely ask them to type their question.
9. [HANDOFF] must appear only at the very end of your reply, and only when needed.

KNOWLEDGE BASE:
${KNOWLEDGE_BASE}`;

// ============ المنطق — ما في داعي تعدّل تحت هاد الخط ============
const store = $getWorkflowStaticData('global');
store.seen = store.seen || [];
store.chats = store.chats || {};

const out = [];

for (const item of $input.all()) {
  const body = item.json.body || item.json;
  const changes = (body.entry || []).flatMap(e => e.changes || []);

  for (const change of changes) {
    const value = change.value || {};
    const messages = value.messages || [];          // تحديثات الحالة (delivered/read) ما فيها messages
    const contacts = value.contacts || [];

    for (const msg of messages) {
      // Meta أحياناً بتعيد إرسال نفس الرسالة — نتجاهل المكرر
      if (store.seen.includes(msg.id)) continue;
      store.seen.push(msg.id);
      if (store.seen.length > 300) store.seen = store.seen.slice(-300);

      const from = msg.from;
      const contact = contacts.find(c => c.wa_id === from) || contacts[0] || {};
      const name = (contact.profile && contact.profile.name) || '';

      let userText;
      if (msg.type === 'text') {
        userText = (msg.text && msg.text.body || '').trim();
      } else if (msg.type === 'interactive') {
        const i = msg.interactive || {};
        userText = (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '';
      } else if (msg.type === 'button') {
        userText = (msg.button && msg.button.text) || '';
      } else {
        userText = `[The customer sent a ${msg.type} message, not text]`;
      }
      if (!userText) continue;
      userText = userText.slice(0, 2000);

      const history = (store.chats[from] && store.chats[from].messages) || [];
      const conversation = [...history, { role: 'user', content: userText }];

      const system = name
        ? `${SYSTEM_PROMPT}\n\nCustomer WhatsApp name: ${name}`
        : SYSTEM_PROMPT;

      out.push({
        json: {
          from,
          name,
          msgId: msg.id,
          userText,
          cfg: CONFIG,
          aiRequest: {
            systemInstruction: { parts: [{ text: system }] },
            contents: conversation.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',   // Gemini بيسمي ردوده "model"
              parts: [{ text: m.content }],
            })),
            generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
          },
        },
      });
    }
  }
}

return out; // إذا فاضي (مثلاً status update) الـ workflow بيوقف هون بهدوء
