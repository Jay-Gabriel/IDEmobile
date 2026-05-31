// Test Gemini native REST API (không dùng OpenAI compat)
require('dotenv').config();
const https = require('https');

const apiKey = process.env.OPENAI_API_KEY;
console.log('Testing API Key:', apiKey?.substring(0, 12) + '...\n');

function testNativeGemini(model) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }]
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.candidates) {
            const text = json.candidates[0]?.content?.parts[0]?.text;
            resolve(`✅ OK (${res.statusCode}): "${text}"`);
          } else if (json.error) {
            resolve(`❌ API Error (${res.statusCode}): ${json.error.message}`);
          } else {
            resolve(`❓ Unknown (${res.statusCode}): ${data.substring(0, 100)}`);
          }
        } catch(e) {
          resolve(`❓ Parse error (${res.statusCode}): ${data.substring(0, 100)}`);
        }
      });
    });

    req.on('error', (e) => resolve(`❌ Request error: ${e.message}`));
    req.write(body);
    req.end();
  });
}

async function main() {
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-pro'];
  for (const model of models) {
    const result = await testNativeGemini(model);
    console.log(`[${model}]: ${result}`);
  }
}

main();
