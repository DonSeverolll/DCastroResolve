// Módulo de IA compartilhado pelos agentes (Llama via Groq, formato OpenAI).
// A ficha cabe numa única chamada (~6k tokens), então não precisa de divisão aqui.
const dotenv = require('dotenv');
dotenv.config();

const llmApiUrl = process.env.LLM_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const llmApiKey = process.env.LLM_API_KEY;
const llmModel = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Faz uma chamada ao LLM. json=true força resposta em JSON. Trata limite de taxa (429).
async function chamarLLM(messages, { maxTokens = 4096, json = false, temperature = 0.1, tentativas = 4 } = {}) {
  if (!llmApiKey || llmApiKey.startsWith('COLE_')) {
    throw new Error('LLM_API_KEY não configurada no .env.');
  }
  for (let i = 0; i < tentativas; i++) {
    const resp = await fetch(llmApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmApiKey}` },
      body: JSON.stringify({
        model: llmModel,
        temperature,
        max_tokens: maxTokens,
        messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (resp.status === 429 && i < tentativas - 1) {
      const wait = (Number(resp.headers.get('retry-after')) || 20) * 1000 + 1000;
      console.log(`[llm] limite de taxa; aguardando ${Math.round(wait / 1000)}s...`);
      await esperar(wait);
      continue;
    }
    if (resp.status === 413) {
      throw new Error(
        'O arquivo é grande demais para o limite gratuito da IA. Confira se enviou a FICHA DE ATENDIMENTO (e não uma petição pronta). Se a ficha for realmente longa, tente um arquivo menor.'
      );
    }
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(`IA ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  }
  throw new Error('Falha na IA após várias tentativas (limite de taxa).');
}

module.exports = { chamarLLM };
