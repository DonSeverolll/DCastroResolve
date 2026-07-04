// Biblioteca de blocos de fundamentação — textos REAIS do escritório (extraídos dos
// modelos), com placeholders para as variáveis da ficha. Princípio: nada é inventado.
// Se uma matéria da ficha não tiver bloco correspondente no modelo, ela NÃO é gerada;
// o Validador sinaliza a ausência (ver agentes.js / validador).
//
// Cada bloco: { titulo, corpo(dados) -> array de parágrafos (strings) }.
// O conteúdo real de cada tese é carregado de peticao/blocos/<chave>.txt (extraído do
// modelo), permitindo fidelidade total sem hardcode. Se o arquivo não existir, o bloco
// fica indisponível.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'blocos');

// Ordem canônica em que os blocos aparecem na petição (segue o modelo do escritório).
const ORDEM_BLOCOS = [
  'terceirizacao',
  'fgts',
  'horasExtras',
  'intervalo',
  'valeAlimentacao',
  'verbasRescisorias',
];

const TITULOS = {
  contrato: 'DO CONTRATO DE TRABALHO',
  terceirizacao: 'DA RESPONSABILIZAÇÃO SUBSIDIÁRIA. RELAÇÃO DE TERCEIRIZAÇÃO',
  fgts: 'DOS DEPÓSITOS DO FGTS NÃO REALIZADOS',
  horasExtras: 'DAS HORAS EXTRAS',
  intervalo: 'DO INTERVALO INTRAJORNADA',
  valeAlimentacao: 'VALE ALIMENTAÇÃO',
  verbasRescisorias: 'DAS VERBAS RESCISÓRIAS',
};

// Substitui placeholders {{campo}} por valores dos dados (usa caminho pontuado, ex: contrato.admissao).
function preencher(texto, dados) {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, chave) => {
    const val = chave.split('.').reduce((o, k) => (o == null ? o : o[k]), dados);
    return val == null || val === '' ? '_____' : String(val);
  });
}

// Carrega o texto real do bloco (do arquivo) e devolve os parágrafos já preenchidos.
function carregarCorpo(chave, dados) {
  const arquivo = path.join(DIR, `${chave}.txt`);
  if (!fs.existsSync(arquivo)) return null;
  const bruto = fs.readFileSync(arquivo, 'utf-8').trim();
  return bruto
    .split(/\n\s*\n/) // parágrafos separados por linha em branco
    .map((p) => preencher(p.replace(/\s*\n\s*/g, ' ').trim(), dados))
    .filter(Boolean);
}

// Monta o objeto BLOCOS apenas com as chaves que têm arquivo de conteúdo disponível.
const BLOCOS = {};
for (const chave of ORDEM_BLOCOS) {
  const arquivo = path.join(DIR, `${chave}.txt`);
  if (fs.existsSync(arquivo)) {
    BLOCOS[chave] = {
      titulo: TITULOS[chave] || chave.toUpperCase(),
      corpo: (dados) => carregarCorpo(chave, dados) || [],
    };
  }
}

module.exports = { BLOCOS, ORDEM_BLOCOS, TITULOS, preencher };
