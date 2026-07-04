// AGENTE VALIDADOR — confere o documento montado antes de gerar o .docx.
// Sinaliza: (a) matérias da ficha SEM modelo/bloco (não inventadas) e
// (b) lacunas de dados (campos que a ficha não trouxe), para o advogado completar.
const { BLOCOS } = require('./blocos');

const MATERIA_BLOCO = {
  fgtsNaoRecolhido: 'fgts',
  horasExtras: 'horasExtras',
  intervaloIntrajornada: 'intervalo',
  valeAlimentacao: 'valeAlimentacao',
  acumuloFuncao: 'acumuloFuncao',
  periculosidade: 'periculosidade',
  insalubridade: 'insalubridade',
  verbasRescisorias: 'verbasRescisorias',
};

const ROTULO = {
  fgtsNaoRecolhido: 'FGTS não recolhido',
  horasExtras: 'Horas extras',
  intervaloIntrajornada: 'Intervalo intrajornada',
  valeAlimentacao: 'Vale-alimentação',
  acumuloFuncao: 'Acúmulo de função',
  periculosidade: 'Periculosidade',
  insalubridade: 'Insalubridade',
  verbasRescisorias: 'Verbas rescisórias',
};

const CAMPOS_RECLAMANTE = {
  nome: 'nome', nacionalidade: 'nacionalidade', estadoCivil: 'estado civil',
  profissao: 'profissão', rg: 'RG', cpf: 'CPF', endereco: 'endereço',
};

function vazio(v) {
  return v == null || v === '' || v === '___' || v === '_____';
}

function validar(dados, docData) {
  const avisos = [];

  // (a) Matérias marcadas na ficha, mas sem bloco/modelo -> não geradas (não inventar).
  const m = dados.materias || {};
  for (const [flag, chave] of Object.entries(MATERIA_BLOCO)) {
    if (m[flag] && !BLOCOS[chave]) {
      avisos.push(`Matéria "${ROTULO[flag]}" consta na ficha, mas o escritório ainda não tem modelo/bloco para ela — NÃO foi gerada (para não inventar tese). Envie um modelo dessa matéria para incluí-la.`);
    }
  }

  // (b) Lacunas de dados: campos sem informação na ficha (o advogado completa depois).
  const lacunas = [];
  const r = docData.reclamante || {};
  for (const [campo, rotulo] of Object.entries(CAMPOS_RECLAMANTE)) {
    if (vazio(r[campo])) lacunas.push(`reclamante — ${rotulo}`);
  }
  for (const [campo, valor] of Object.entries(docData.contrato || {})) {
    if (vazio(valor)) lacunas.push(`contrato — ${campo}`);
  }
  for (const b of docData.blocos || []) {
    if (b.paragrafos.some((p) => p.includes('_____'))) {
      lacunas.push(`tese "${b.titulo}" tem campo sem preenchimento`);
    }
  }
  if (vazio(docData.valorCausa) || /_____/.test(docData.valorCausa || '')) {
    lacunas.push('valor da causa (a apurar)');
  }

  if (lacunas.length) {
    avisos.push(`Lacunas a completar (dado ausente na ficha): ${lacunas.join('; ')}.`);
  }

  return avisos;
}

module.exports = { validar };
