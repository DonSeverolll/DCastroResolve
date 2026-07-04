// AGENTE PREENCHEDOR — monta o objeto final da petição (a "base" preenchida) a partir
// dos dados extraídos e dos blocos selecionados. A validação/lacunas ficam no Validador.

const { BLOCOS } = require('./blocos');

// Monta a qualificação da reclamada (empresa) a partir dos dados.
function qualificarReclamada(r) {
  const partes = ['empresa privada'];
  if (r.cnpj) partes.push(`inscrita no CNPJ sob o nº ${r.cnpj}`);
  if (r.endereco) partes.push(`situada na ${r.endereco}`);
  return partes.join(', ');
}

// Formata CPF (11 dígitos) como 000.000.000-00; devolve o original se não bater.
function formatarCpf(cpf) {
  if (!cpf) return cpf;
  const d = String(cpf).replace(/\D/g, '');
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : cpf;
}

// Texto do pedido correspondente a cada matéria (segue o rol do modelo).
const PEDIDOS = {
  terceirizacao: 'reconhecimento da responsabilidade subsidiária da(s) tomadora(s) de serviço, nos termos da Súmula 331, IV, do TST',
  fgts: 'recolhimento das diferenças de FGTS não depositadas ao longo do contrato, acrescido da multa de 40%',
  horasExtras: 'pagamento das horas extras laboradas e não quitadas, com adicional legal e reflexos',
  intervalo: 'pagamento do intervalo intrajornada suprimido, como hora extra, nos termos da Súmula 437 do TST',
  valeAlimentacao: 'pagamento do vale-alimentação em atraso e não fornecido',
  verbasRescisorias: 'pagamento das verbas rescisórias e liberação do seguro-desemprego e FGTS + 40%',
};

function preenchedor(dados, blocosSelecionados) {
  const blocos = [];
  const pedidos = [];

  // Monta os blocos de fundamentação (texto real do escritório + variáveis da ficha).
  for (const chave of blocosSelecionados) {
    const b = BLOCOS[chave];
    if (!b) continue;
    const paragrafos = b.corpo(dados);
    if (!paragrafos.length) continue;
    blocos.push({ chave, titulo: b.titulo, paragrafos });
    if (PEDIDOS[chave]) pedidos.push(PEDIDOS[chave]);
  }

  const reclamante = { ...(dados.reclamante || {}) };
  if (reclamante.cpf) reclamante.cpf = formatarCpf(reclamante.cpf);

  return {
    vara: '___',
    reclamante,
    reclamadas: (dados.reclamadas || []).map((r) => ({ nome: r.nome, qualif: qualificarReclamada(r) })),
    contrato: {
      admissao: dados.contrato?.admissao || '___',
      funcao: dados.contrato?.funcao || '___',
      dispensa: dados.contrato?.demissao || '___',
      projecaoAviso: dados.contrato?.avisoPrevio || '___',
      ultimoSalario: dados.contrato?.salario || '___',
    },
    blocos,
    pedidos,
    valorCausa: dados.valorCausa || 'R$ _____ (a apurar em regular liquidação)',
    data: dados.data || `Recife - PE, ${new Date().toLocaleDateString('pt-BR')}.`,
  };
}

module.exports = { preenchedor };
