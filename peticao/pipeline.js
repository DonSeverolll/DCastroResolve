// Orquestrador do pipeline: ficha (texto) -> petição (.docx).
// Encadeia os agentes: Extrator -> Classificador -> Preenchedor (+ Validador) -> Motor.
const { extrator, classificador } = require('./agentes');
const { preenchedor } = require('./preenchedor');
const { validar } = require('./validador');
const { gerarPeticao } = require('./motor');

async function gerarPeticaoDaFicha(fichaTexto) {
  // 1. Extrator: ficha -> dados estruturados
  const dados = await extrator(fichaTexto);
  // 2. Classificador: quais teses/blocos se aplicam (e têm modelo)
  const blocosSelecionados = classificador(dados);
  // 3. Preenchedor: preenche a base (dados + teses do escritório)
  const docData = preenchedor(dados, blocosSelecionados);
  // 4. Validador: matérias sem modelo + lacunas de dados a completar
  const avisos = validar(dados, docData);
  // 5. Motor: gera o .docx no formato do escritório
  const docx = await gerarPeticao(docData);

  return {
    docx,
    avisos,
    resumo: {
      reclamante: dados.reclamante?.nome || null,
      reclamadas: (dados.reclamadas || []).map((r) => r.nome),
      materias: dados.materias || {},
      blocosGerados: docData.blocos.map((b) => b.titulo),
      pedidos: docData.pedidos.length,
    },
  };
}

module.exports = { gerarPeticaoDaFicha };
