// Agentes do pipeline: Extrator e Classificador.
const { chamarLLM } = require('./llm');
const { BLOCOS, ORDEM_BLOCOS } = require('./blocos');

// Cada trecho enviado à IA fica sob o limite gratuito (12k tokens/min).
const MAX_CHARS_EXTRACAO = 24000;

// ---------------------------------------------------------------------------
// AGENTE EXTRATOR — lê a ficha (texto) e devolve dados estruturados (JSON).
// Regra de ouro: só extrai o que está no texto; nada é inventado.
// Fichas grandes são divididas automaticamente e os dados são mesclados.
// ---------------------------------------------------------------------------
const SCHEMA = `{
  "reclamante": {
    "nome": "string", "nacionalidade": "string", "estadoCivil": "string",
    "profissao": "string", "rg": "string", "cpf": "string",
    "endereco": "string (rua, nº, bairro, cidade/UF, CEP)", "email": "string", "telefone": "string"
  },
  "reclamadas": [
    { "nome": "string", "cnpj": "string", "endereco": "string",
      "tipo": "terceirizada | tomadora/contratante" }
  ],
  "contrato": {
    "admissao": "dd/mm/aaaa", "demissao": "dd/mm/aaaa", "funcao": "string",
    "salario": "string (ex: R$ 1.595,74)", "formaRescisao": "string", "avisoPrevio": "string"
  },
  "jornada": {
    "escala": "string (ex: 12x36)", "horarioContratual": "string",
    "horarioReal": "string", "intervalo": "string",
    "trabalhaDomingosFeriados": "string"
  },
  "materias": {
    "verbasRescisorias": true/false, "horasExtras": true/false,
    "intervaloIntrajornada": true/false, "valeAlimentacao": true/false,
    "valeTransporte": true/false, "acumuloFuncao": true/false,
    "periculosidade": true/false, "insalubridade": true/false,
    "fgtsNaoRecolhido": true/false, "salariosAtrasados": true/false
  },
  "detalhes": {
    "acumuloFuncao": "string (funções acumuladas, se houver)",
    "periculosidade": "string (motivo: arma, etc, se houver)",
    "fgts": "string (situação do FGTS, se houver)",
    "valeAlimentacao": "string (situação, se houver)",
    "horasExtras": "string (resumo da jornada excedente, se houver)"
  }
}`;

// Remove o ruído de assinatura eletrônica (ZapSign, relatório de assinaturas)
// para reduzir tokens e focar no conteúdo real da ficha.
function limparFicha(texto) {
  const RUIDO =
    /(ZapSign|Assinado\s*digitalmente|Assinado\s*via|Documento assinado eletronicamente|MP 2\.200-2|Lei 14\.063|Relatório de Assinaturas|INTEGRIDADE CERTIFICADA|ICP-BRASIL|^\s*Token:|^\s*IP:|Dispositivo:|Pontos de autenticação|Data e hora da (assinatura|validação)|Selfie|Documento de Identidade|Localização aproximada|Última atualização em|Hash do documento|^\s*Número:|Data da criação|Assinaturas\d|Confirme a integridade|Este Log|Anexos|C O N F I D E N T I A L|Status: Assinado)/i;
  return texto
    .split('\n')
    .filter((linha) => linha.trim() === '' || !RUIDO.test(linha))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Divide o texto em trechos de no máximo maxChars, respeitando parágrafos.
function dividirTexto(texto, maxChars) {
  const chunks = [];
  let atual = '';
  for (const p of texto.split('\n')) {
    if (p.length > maxChars) {
      if (atual) {
        chunks.push(atual);
        atual = '';
      }
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
      continue;
    }
    if (atual && atual.length + 1 + p.length > maxChars) {
      chunks.push(atual);
      atual = p;
    } else {
      atual = atual ? `${atual}\n${p}` : p;
    }
  }
  if (atual) chunks.push(atual);
  return chunks.length ? chunks : [texto];
}

// Extrai os dados de UM trecho da ficha (uma chamada à IA).
async function extrairDeChunk(texto) {
  const system =
    'Você é um assistente jurídico trabalhista que extrai dados de fichas de atendimento. ' +
    'Extraia SOMENTE informações presentes no texto. Se um campo não constar, use null (ou [] para listas, false para booleanos). ' +
    'NUNCA invente nomes, datas, valores ou fatos. Responda APENAS com JSON válido no formato pedido.';
  const user = `Formato JSON esperado (preencha com os dados da ficha):\n${SCHEMA}\n\n=== FICHA DE ATENDIMENTO (trecho) ===\n${texto}`;
  const raw = await chamarLLM(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { json: true, maxTokens: 2048, temperature: 0 }
  );
  return JSON.parse(raw);
}

// Mescla os dados parciais de vários trechos num único objeto.
function mesclarDados(parciais) {
  const base = { reclamante: {}, reclamadas: [], contrato: {}, jornada: {}, materias: {}, detalhes: {} };
  const preencheSeVazio = (obj, k, v) => {
    if ((obj[k] == null || obj[k] === '') && v != null && v !== '') obj[k] = v;
  };
  for (const p of parciais) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p.reclamante || {})) preencheSeVazio(base.reclamante, k, v);
    for (const [k, v] of Object.entries(p.contrato || {})) preencheSeVazio(base.contrato, k, v);
    for (const [k, v] of Object.entries(p.jornada || {})) preencheSeVazio(base.jornada, k, v);
    for (const [k, v] of Object.entries(p.detalhes || {})) preencheSeVazio(base.detalhes, k, v);
    for (const [k, v] of Object.entries(p.materias || {})) base.materias[k] = base.materias[k] || !!v;
    for (const r of p.reclamadas || []) {
      const dup = base.reclamadas.some(
        (x) => (r.cnpj && x.cnpj === r.cnpj) || (r.nome && (x.nome || '').toLowerCase() === r.nome.toLowerCase())
      );
      if (!dup && (r.nome || r.cnpj)) base.reclamadas.push(r);
    }
  }
  return base;
}

async function extrator(fichaTexto) {
  const texto = limparFicha(fichaTexto);
  const chunks = dividirTexto(texto, MAX_CHARS_EXTRACAO);

  // Ficha normal: uma única chamada.
  if (chunks.length === 1) return extrairDeChunk(chunks[0]);

  // Ficha grande: extrai de cada trecho e mescla (o chamarLLM já espera em caso de 429).
  console.log(`Ficha grande: extraindo em ${chunks.length} trechos...`);
  const parciais = [];
  for (const chunk of chunks) {
    const r = await extrairDeChunk(chunk).catch((e) => {
      console.warn('Trecho ignorado na extração:', e.message);
      return null;
    });
    parciais.push(r);
  }
  const validos = parciais.filter(Boolean);
  if (!validos.length) throw new Error('Não foi possível extrair dados da ficha.');
  return mesclarDados(validos);
}

// ---------------------------------------------------------------------------
// AGENTE CLASSIFICADOR — decide quais blocos de fundamentação entram e a ordem.
// ---------------------------------------------------------------------------
function classificador(dados) {
  const m = dados.materias || {};
  const temTomadora = (dados.reclamadas || []).some(
    (r) => r.tipo && /tomadora|contratante/i.test(r.tipo)
  );

  const selecionados = new Set();
  if (temTomadora || (dados.reclamadas || []).length > 1) selecionados.add('terceirizacao');
  if (m.fgtsNaoRecolhido) selecionados.add('fgts');
  if (m.horasExtras) selecionados.add('horasExtras');
  if (m.intervaloIntrajornada || m.horasExtras) selecionados.add('intervalo');
  if (m.valeAlimentacao) selecionados.add('valeAlimentacao');
  if (m.acumuloFuncao) selecionados.add('acumuloFuncao');
  if (m.periculosidade) selecionados.add('periculosidade');
  if (m.verbasRescisorias) selecionados.add('verbasRescisorias');

  return ORDEM_BLOCOS.filter((k) => selecionados.has(k) && BLOCOS[k]);
}

module.exports = { extrator, classificador };
