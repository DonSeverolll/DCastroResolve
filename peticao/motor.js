// Motor de Documentos — gera a petição inicial em .docx no formato do escritório DCastro.
// Reproduz o timbrado (cabeçalho + rodapé), a tipografia (Kalinga 12) e a estrutura.
// Recebe `dados` (estruturados pela ficha) e monta o documento; nada de texto é inventado:
// o texto jurídico fixo vem dos modelos do escritório (blocos), e as variáveis vêm da ficha.

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer,
  AlignmentType, HorizontalPositionRelativeFrom, HorizontalPositionAlign,
  VerticalPositionRelativeFrom, VerticalPositionAlign, TextWrappingType,
} = require('docx');

const ASSETS = path.join(__dirname, 'assets');
const IMG_HEADER = fs.readFileSync(path.join(ASSETS, 'timbrado_header.png'));
const IMG_FOOTER = fs.readFileSync(path.join(ASSETS, 'timbrado_footer.png'));

const FONTE = 'Kalinga';
const TAM = 24; // 12pt (docx usa meio-ponto)
const LINHA = { line: 360, lineRule: 'auto' }; // 1,5 linha
const RECUO = 708; // recuo de 1a linha ~1,25cm

// ---- Dados fixos do escritório (constam nos modelos, não são inventados) ----
const ADVOGADO_NOTIFICACAO =
  'DAVYDSON ARAÚJO DE CASTRO, OAB/PE 28.800, com endereço profissional na Av. General Mac Arthur, 418, Sala 1104, Imbiribeira, Recife-PE, CEP 51160-280';
const ADVOGADOS_FECHO = [
  ['DAVYDSON ARAÚJO DE CASTRO', 'OAB/PE nº 28.800'],
  ['DIEGO ARAÚJO DE CASTRO', 'OAB/PE nº 45.016'],
  ['ANNE BEATRIZ MOREIRA DE LACERDA', 'OAB/PE nº 43.694'],
  ['RUAMA DOMINGOS DE MORAIS', 'OAB/PE nº 65.100'],
  ['HELOÍSA CARDOSO FERREIRA', 'OAB/PE n° 53.947'],
];

// ---- Helpers de formatação ----
function txt(text, opts = {}) {
  return new TextRun({ text, font: FONTE, size: TAM, bold: !!opts.bold, highlight: opts.highlight });
}
// Parágrafo de corpo: justificado, recuo de 1a linha, 1,5 linha.
function corpo(runs, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { ...LINHA, after: opts.after ?? 120 },
    indent: { firstLine: opts.indent ?? RECUO },
    children: Array.isArray(runs) ? runs : [txt(runs)],
  });
}
// Título de seção: negrito. center=true para os títulos centralizados.
function titulo(text, opts = {}) {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
    spacing: { ...LINHA, before: 160, after: 120 },
    indent: opts.center ? undefined : { firstLine: 0 },
    children: [txt(text, { bold: true })],
  });
}
function centro(runs, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { ...LINHA, after: opts.after ?? 0 },
    children: Array.isArray(runs) ? runs : [txt(runs, opts)],
  });
}
function vazio() {
  return new Paragraph({ children: [txt('')] });
}

// ---- Timbrado: logo no cabeçalho, faixa no rodapé (imagem flutuante full-width) ----
function cabecalho() {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [
          new ImageRun({
            type: 'png',
            data: IMG_HEADER,
            transformation: { width: 175, height: 49 },
            altText: { title: 'DCastro', description: 'Timbrado DCastro Advogados', name: 'timbrado' },
          }),
        ],
      }),
    ],
  });
}
function rodape() {
  return new Footer({
    children: [
      new Paragraph({
        children: [
          new ImageRun({
            type: 'png',
            data: IMG_FOOTER,
            transformation: { width: 794, height: 53 },
            altText: { title: 'Rodapé DCastro', description: 'Contatos DCastro', name: 'rodape' },
            floating: {
              horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, align: HorizontalPositionAlign.CENTER },
              verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, align: VerticalPositionAlign.BOTTOM },
              allowOverlap: true,
              wrap: { type: TextWrappingType.NONE },
            },
          }),
        ],
      }),
    ],
  });
}

// ---- Montagem do corpo da petição a partir dos dados ----
function montarCorpo(d) {
  const r = d.reclamante;
  const filhos = [];

  // Endereçamento
  filhos.push(
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { ...LINHA, after: 240 },
      children: [
        txt(`EXCELENTÍSSIMO (A) SENHOR (A) DOUTOR (A) JUIZ (A) DA ${d.vara || '___'} VARA DA JUSTIÇA DO TRABALHO DE RECIFE – PE.`, { bold: true }),
      ],
    })
  );

  // Qualificação do reclamante
  filhos.push(
    corpo([
      txt(`${r.nome}`, { bold: true }),
      txt(`, ${r.nacionalidade}, ${r.estadoCivil}, ${r.profissao}, portador(a) da cédula de identidade nº ${r.rg} e inscrito(a) no CPF nº ${r.cpf}, residente e domiciliado(a) na ${r.endereco}, email: ${r.email}, telefone: ${r.telefone}, por meio de seu advogado devidamente constituído e que abaixo subscreve, conforme procuração anexa, com endereço profissional constante no respectivo instrumento, local onde desde já requer que sejam enviadas as notificações/intimações necessárias ao feito, vem, mui respeitosamente à presença de Vossa Excelência, nos termos do artigo 840, § 1º da CLT, ajuizar a presente:`),
    ], { after: 160 })
  );

  // Título da ação
  filhos.push(titulo('RECLAMAÇÃO TRABALHISTA', { center: true }));

  // Qualificação das reclamadas
  const partes = [txt('Em face da ')];
  d.reclamadas.forEach((rec, i) => {
    partes.push(txt(rec.nome, { bold: true }));
    partes.push(txt(`, ${rec.qualif}`));
    if (i < d.reclamadas.length - 1) partes.push(txt(i === d.reclamadas.length - 2 ? ', e ' : ', '));
  });
  partes.push(txt(', pelos fatos e fundamentos a seguir expendidos.'));
  filhos.push(corpo(partes, { after: 160 }));

  // Preliminares (boilerplate do escritório)
  filhos.push(titulo('I - DA JUSTIÇA GRATUITA'));
  filhos.push(corpo('Requer o Reclamante, de logo, pelo benefício da Justiça Gratuita, nos termos do artigo 5º inciso LXXIV da Constituição Federal, por se encontrar sem condições de arcar com as despesas processuais sem prejuízo do seu próprio sustento ou de seus familiares, e demais despesas que possam advir da presente ação.'));
  filhos.push(corpo('Ressalte-se, ainda, que em razão do último salário contratual do autor ser inferior a 40% (quarenta por cento) do limite máximo dos benefícios do Regime Geral de Previdência Social, despicienda é a comprovação da impossibilidade de arcar com as despesas oriundas do processo, eis que presumível a sua hipossuficiência, a ex vi do disposto no art. 790 §3º da CLT, modificado através da Lei 13.467/2017.'));

  filhos.push(titulo('II - DAS NOTIFICAÇÕES'));
  filhos.push(corpo(`Requer, em conformidade com a Súmula 427 do TST, e procuração assinada pelo autor (doc. anexo) que todas as notificações, intimações e publicações, sejam feitas exclusivamente em nome do advogado ${ADVOGADO_NOTIFICACAO}.`));

  filhos.push(titulo('III – DOS DOCUMENTOS ANEXADOS'));
  filhos.push(corpo('Declaram os patronos que abaixo subscrevem, com fulcro no que dispõe a nova redação do art. 830 da CLT, e com observância ao termo de responsabilidade assinado na procuração anexa, que os documentos apresentados pela parte autora, colacionados à presente exordial, são autênticos.'));

  filhos.push(titulo('IV - DO FORO COMPETENTE'));
  filhos.push(corpo('Faz-se oportuno esclarecer que durante o liame empregatício o reclamante exerceu suas atividades profissionais nesta jurisdição, sendo este, pois, o foro competente para apreciar e julgar a presente demanda, conforme prevê o artigo 651 da Consolidação das Leis do Trabalho, cuja exegese do parágrafo 3º faculta ao empregado ajuizar reclamação ou no foro de celebração do contrato de trabalho ou no da prestação dos seus respectivos serviços.'));

  filhos.push(titulo('V – DA NECESSIDADE DE PROCESSAMENTO DA DEMANDA EM JUÍZO 100% DIGITAL'));
  filhos.push(corpo('Requer-se que a presente demanda tramite através do Juízo 100% digital, subsidiariamente, caso discorde a parte ré ou este Juízo, pugna pela realização de audiência telepresencial, ao menos ao patrono e ao autor, e subsidiariamente ainda, caso este Juízo assim não entenda, pugna pela que seja permitida a modalidade híbrida, facultando às partes o comparecimento de forma virtual.'));

  // Fatos e fundamentos (contrato)
  filhos.push(titulo('DOS FATOS E FUNDAMENTOS', { center: true }));
  filhos.push(titulo('DO CONTRATO DE TRABALHO'));
  const c = d.contrato;
  const temProjecao = c.projecaoAviso && /\d/.test(String(c.projecaoAviso));
  const clausulaAviso = temProjecao
    ? `, se estendendo o contrato de trabalho até o dia ${c.projecaoAviso}, em razão da projeção do aviso prévio`
    : ', com projeção do aviso prévio indenizado';
  filhos.push(corpo(`O reclamante foi admitido em ${c.admissao}, para exercer a função de ${c.funcao}, tendo sido despedido sem justa causa em ${c.dispensa}${clausulaAviso}.`));
  filhos.push(corpo(`Recebeu como último salário o valor de ${c.ultimoSalario}.`));

  // Blocos de fundamentação selecionados pelo Classificador (teses reais do escritório).
  for (const bloco of d.blocos || []) {
    filhos.push(titulo(bloco.titulo));
    for (const p of bloco.paragrafos) filhos.push(corpo(p));
  }

  // DOS PEDIDOS
  if (d.pedidos && d.pedidos.length) {
    filhos.push(titulo('DOS PEDIDOS', { center: true }));
    filhos.push(corpo('Ante o exposto, requer a Vossa Excelência a procedência dos pedidos, condenando-se as reclamadas, solidária e/ou subsidiariamente, ao pagamento de:'));
    d.pedidos.forEach((p, i) => {
      const letra = String.fromCharCode(97 + (i % 26));
      filhos.push(corpo([txt(`${letra}) `), txt(p)], { indent: 360 }));
    });
  }

  // Ressalva destacada (realce amarelo, como no modelo)
  filhos.push(
    corpo([
      txt('Por fim, reforça-se mais uma vez o caráter estimativos dos valores atribuídos aos pedidos, de modo que não se pode imputar ao autor qualquer limitação ou penalidade por eventuais erros de cálculo.', { highlight: 'yellow' }),
    ])
  );

  // Valor da causa
  filhos.push(corpo([
    txt('Dá-se à causa, tão somente para efeitos fiscais, o valor de '),
    txt(d.valorCausa, { bold: true }),
  ]));

  // Fecho
  filhos.push(vazio());
  filhos.push(corpo('Nestes termos,', { indent: 0, after: 0 }));
  filhos.push(corpo('Pede deferimento.', { indent: 0, after: 0 }));
  filhos.push(corpo(d.data, { indent: 0, after: 240 }));

  ADVOGADOS_FECHO.forEach(([nome, oab]) => {
    filhos.push(vazio());
    filhos.push(centro(nome, { bold: true, after: 0 }));
    filhos.push(centro(oab, { bold: true }));
  });

  return filhos;
}

// ---- API pública: gera o .docx e devolve um Buffer ----
async function gerarPeticao(dados) {
  const doc = new Document({
    styles: { default: { document: { run: { font: FONTE, size: TAM } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 2400, bottom: 1650, left: 1700, right: 1620, header: 600, footer: 300 },
          },
        },
        headers: { default: cabecalho() },
        footers: { default: rodape() },
        children: montarCorpo(dados),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

module.exports = { gerarPeticao };
