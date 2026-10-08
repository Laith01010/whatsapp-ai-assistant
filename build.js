// Builds the importable n8n workflow from the node source files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const read = f => fs.readFileSync(path.join(__dirname, 'nodes', f), 'utf8');
const id = () => crypto.randomUUID();

const nodes = [
  {
    id: id(), name: 'WhatsApp Verify (GET)', type: 'n8n-nodes-base.webhook', typeVersion: 2,
    position: [0, 0], webhookId: id(),
    parameters: { httpMethod: 'GET', path: 'whatsapp', responseMode: 'responseNode', options: {} },
  },
  {
    id: id(), name: 'Verify Token', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [220, 0], parameters: { jsCode: read('verify-token.js') },
  },
  {
    id: id(), name: 'Respond Challenge', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
    position: [440, 0],
    parameters: {
      respondWith: 'text',
      responseBody: '={{ $json.body }}',
      options: { responseCode: '={{ $json.status }}' },
    },
  },
  {
    id: id(), name: 'WhatsApp Incoming (POST)', type: 'n8n-nodes-base.webhook', typeVersion: 2,
    position: [0, 260], webhookId: id(),
    parameters: { httpMethod: 'POST', path: 'whatsapp', responseMode: 'onReceived', options: {} },
  },
  {
    id: id(), name: 'Parse Message', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [220, 260], parameters: { jsCode: read('parse-message.js') },
  },
  {
    id: id(), name: 'Ask Gemini', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
    position: [440, 260], onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: '=https://generativelanguage.googleapis.com/v1beta/models/{{ $json.cfg.MODEL }}:generateContent',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'x-goog-api-key', value: '={{ $json.cfg.GEMINI_API_KEY }}' },
        { name: 'Content-Type', value: 'application/json' },
      ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.aiRequest) }}',
      options: { timeout: 30000 },
    },
  },
  {
    id: id(), name: 'Process Reply', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [660, 260], parameters: { jsCode: read('process-reply.js') },
  },
  {
    id: id(), name: 'Send WhatsApp Reply', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
    position: [880, 260], onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: '=https://graph.facebook.com/{{ $json.cfg.GRAPH_VERSION }}/{{ $json.cfg.PHONE_NUMBER_ID }}/messages',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Authorization', value: '=Bearer {{ $json.cfg.WHATSAPP_TOKEN }}' },
      ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.sendRequest) }}',
      options: {},
    },
  },
  {
    id: id(), name: 'Needs Human?', type: 'n8n-nodes-base.if', typeVersion: 2,
    position: [1100, 260],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{
          id: id(),
          leftValue: "={{ $('Process Reply').item.json.handoff }}",
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: id(), name: 'Notify Staff', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
    position: [1320, 180], onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: "=https://graph.facebook.com/{{ $('Process Reply').item.json.cfg.GRAPH_VERSION }}/{{ $('Process Reply').item.json.cfg.PHONE_NUMBER_ID }}/messages",
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Authorization', value: "=Bearer {{ $('Process Reply').item.json.cfg.WHATSAPP_TOKEN }}" },
      ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: "={{ JSON.stringify($('Process Reply').item.json.staffRequest) }}",
      options: {},
    },
  },
];

const link = to => ({ main: [[{ node: to, type: 'main', index: 0 }]] });
const connections = {
  'WhatsApp Verify (GET)': link('Verify Token'),
  'Verify Token': link('Respond Challenge'),
  'WhatsApp Incoming (POST)': link('Parse Message'),
  'Parse Message': link('Ask Gemini'),
  'Ask Gemini': link('Process Reply'),
  'Process Reply': link('Send WhatsApp Reply'),
  'Send WhatsApp Reply': link('Needs Human?'),
  'Needs Human?': { main: [[{ node: 'Notify Staff', type: 'main', index: 0 }], []] },
};

const workflow = {
  name: 'WhatsApp AI Assistant — Medical Fitness Center (Demo)',
  nodes, connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

const outFile = path.join(__dirname, 'whatsapp-ai-bot.n8n.json');
fs.writeFileSync(outFile, JSON.stringify(workflow, null, 2));
console.log('wrote', outFile, nodes.length, 'nodes');
