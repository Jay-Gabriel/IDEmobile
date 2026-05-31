// Test trực tiếp Gemini API với nhiều model/endpoint
require('dotenv').config();
const OpenAI = require('openai').default;

const apiKey = process.env.OPENAI_API_KEY;
console.log('API Key prefix:', apiKey?.substring(0, 12) + '...');

const endpoints = [
  'https://generativelanguage.googleapis.com/v1beta/openai/',
  'https://generativelanguage.googleapis.com/v1/openai/',
];

const models = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-pro',
];

async function testEndpointModel(baseURL, model) {
  const client = new OpenAI({ apiKey, baseURL });
  try {
    const r = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Say: OK' }],
      max_tokens: 10
    });
    return `✅ OK: "${r.choices[0].message.content}"`;
  } catch(e) {
    return `❌ FAIL ${e.status}: ${e.message}`;
  }
}

async function main() {
  for (const baseURL of endpoints) {
    console.log(`\n=== Endpoint: ${baseURL} ===`);
    for (const model of models) {
      const result = await testEndpointModel(baseURL, model);
      console.log(`  [${model}]: ${result}`);
    }
  }
}

main().catch(console.error);

