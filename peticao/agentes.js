// Agentes do pipeline: Extrator, Classificador, Preenchedor e Validador.
const { chamarLLM } = require('./llm');
const { BLOCOS, ORDEM_BLOCOS } = require('./blocos');

// ---------------------------------------------------------------------------
// AGENTE EXTRATOR — lê a ficha (texto) e devolve dados estruturados (JSON).
// Regra de ouro: só extrai o que está no texto; nada é inventado.
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

async function extrator(fichaTexto) {
  const system =
    'Você é um assistente jurídico trabalhista que extrai dados de fichas de atendimento. ' +
    'Extraia SOMENTE informações presentes no texto. Se um campo não constar, use null (ou [] para listas, false para booleanos). ' +
    'NUNCA invente nomes, datas, valores ou fatos. Responda APENAS com JSON válido no formato pedido.';
  const user = `Formato JSON esperado (preencha com os dados da ficha):\n${SCHEMA}\n\n=== FICHA DE ATENDIMENTO ===\n${fichaTexto}`;
  const raw = await chamarLLM(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { json: true, maxTokens: 4096, temperature: 0 }
  );
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// AGENTE CLASSIFICADOR — decide, a partir dos dados, quais blocos de
// fundamentação (teses do escritório) entram na petição e em que ordem.
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

  // Só inclui blocos que existem na biblioteca, na ordem canônica.
  const blocos = ORDEM_BLOCOS.filter((k) => selecionados.has(k) && BLOCOS[k]);
  return blocos;
}

module.exports = { extrator, classificador };
