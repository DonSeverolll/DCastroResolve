const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { gerarPeticaoDaFicha } = require('./peticao/pipeline');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const bucketName = process.env.SUPABASE_BUCKET || 'uploads';

// Configuração da IA (Llama via Groq — compatível com OpenAI).
// A chave fica SÓ aqui no backend, nunca no frontend.
const llmApiUrl = process.env.LLM_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const llmApiKey = process.env.LLM_API_KEY;
const llmModel = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
const llmMaxTokens = Number(process.env.LLM_MAX_TOKENS) || 4096;

if (!supabaseUrl || !supabaseKey) {
  console.error('Erro: SUPABASE_URL e SUPABASE_KEY devem estar definidos no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

async function saveLatestMetadata(metadata) {
  const payload = JSON.stringify(metadata, null, 2);
  const { error } = await supabase.storage
    .from(bucketName)
    .upload('metadata/latest.json', Buffer.from(payload, 'utf-8'), {
      cacheControl: '3600',
      contentType: 'application/json',
      upsert: true,
    });

  if (error) {
    console.error('Erro ao salvar metadados:', error.message);
    throw error;
  }
}

async function getLatestMetadata() {
  const { data, error } = await supabase.storage.from(bucketName).download('metadata/latest.json');
  if (error) {
    if (error.statusCode === 404) return null;
    console.error('Erro ao ler metadados:', error.message);
    throw error;
  }
  const json = await data.text();
  return JSON.parse(json);
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const prompt = req.body.prompt?.trim() ?? '';
    const file = req.file;

    if (!prompt && !file) {
      return res.status(400).json({ error: 'Envie um prompt ou um arquivo.' });
    }

    const timestamp = Date.now();
    let objectPath;
    let originalName = null;
    let mimeType = 'text/plain';
    let size = 0;
    let type = 'prompt';

    if (file) {
      originalName = file.originalname;
      mimeType = file.mimetype;
      size = file.size;
      type = 'file';
      objectPath = `files/${timestamp}-${originalName}`;

      const { error } = await supabase.storage.from(bucketName).upload(objectPath, file.buffer, {
        cacheControl: '3600',
        contentType: mimeType,
        upsert: false,
        metadata: {
          originalName,
          prompt,
          type,
        },
      });

      if (error) {
        console.error('Erro ao enviar arquivo para Supabase:', error.message);
        return res.status(500).json({ error: 'Falha ao enviar arquivo para o storage.' });
      }
    } else {
      const promptFileName = `prompts/${timestamp}-prompt.txt`;
      objectPath = promptFileName;
      const { error } = await supabase.storage.from(bucketName).upload(objectPath, Buffer.from(prompt, 'utf-8'), {
        cacheControl: '3600',
        contentType: 'text/plain',
        upsert: false,
        metadata: {
          prompt,
          type,
        },
      });

      if (error) {
        console.error('Erro ao salvar prompt no Supabase:', error.message);
        return res.status(500).json({ error: 'Falha ao salvar prompt no storage.' });
      }
    }

    const metadata = {
      objectPath,
      prompt,
      originalName,
      mimeType,
      size,
      type,
      createdAt: new Date().toISOString(),
    };

    await saveLatestMetadata(metadata);
    res.json({ success: true, metadata });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno ao processar os dados.' });
  }
});

// ---------- Fluxo de IA: PDF -> Llama -> novo PDF ----------

app.post('/api/processar', upload.single('arquivo'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    const ehPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    if (!ehPdf) {
      return res.status(400).json({ error: 'Envie um arquivo PDF.' });
    }

    // 1. Extrair o texto do PDF recebido
    const textoOriginal = await extrairTextoPdf(file.buffer);
    if (!textoOriginal) {
      return res.status(400).json({
        error: 'Não foi possível extrair texto do PDF (pode ser um PDF digitalizado/imagem).',
      });
    }

    // 2. Enviar o conteúdo para a IA (chave só existe aqui no servidor)
    const respostaIA = await chamarIA(textoOriginal);

    // 3. Gerar um novo PDF com a resposta
    const pdfSaida = await gerarPdfResposta(respostaIA);

    // 4. Guardar entrada e saída no Supabase (bucket privado)
    const timestamp = Date.now();
    const caminhoEntrada = `processados/entrada/${timestamp}-${file.originalname}`;
    const caminhoSaida = `processados/saida/${timestamp}-resultado.pdf`;

    await supabase.storage.from(bucketName).upload(caminhoEntrada, file.buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

    const { error: erroSaida } = await supabase.storage.from(bucketName).upload(caminhoSaida, pdfSaida, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (erroSaida) {
      console.error('Erro ao salvar PDF de saída:', erroSaida.message);
      return res.status(500).json({ error: 'Falha ao salvar o PDF gerado.' });
    }

    // 5. Link de download temporário (URL assinada, válida por 1 hora)
    const { data: assinada, error: erroUrl } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(caminhoSaida, 3600);
    if (erroUrl) {
      console.error('Erro ao gerar URL assinada:', erroUrl.message);
      return res.status(500).json({ error: 'Arquivo gerado, mas falhou ao criar o link de download.' });
    }

    res.json({
      sucesso: true,
      arquivo: assinada.signedUrl,
      preview: respostaIA.slice(0, 500),
    });
  } catch (error) {
    console.error('Erro em /api/processar:', error);
    res.status(500).json({ error: error.message || 'Falha ao processar o arquivo.' });
  }
});

// Extrai o texto de um PDF (Buffer) usando pdf-parse.
async function extrairTextoPdf(buffer) {
  const dados = await pdfParse(buffer);
  return (dados.text || '').trim();
}

// ---------- Chamada à IA com divisão automática (respeita o limite grátis) ----------

const TPM_LIMIT = Number(process.env.LLM_TPM_LIMIT) || 12000; // tokens por minuto do plano
const CHUNK_CHARS = Number(process.env.LLM_CHUNK_CHARS) || 20000; // tamanho de cada trecho
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROMPT_DIRETO =
  'Você é um assistente jurídico. Resolva o problema descrito no documento e devolva apenas a resposta final, em português, bem organizada e pronta para ser colocada em um PDF. Use texto simples, sem tabelas nem markdown.';
const PROMPT_MAP =
  'Você é um assistente jurídico. O texto abaixo é um TRECHO de um documento maior. Resuma de forma objetiva os pontos juridicamente relevantes deste trecho (fatos, partes, pedidos, fundamentos, datas e valores). Não tire conclusões finais — é apenas um trecho.';
const PROMPT_REDUCE =
  'Você é um assistente jurídico. Abaixo estão os resumos de todos os trechos de um documento jurídico. Com base neles, resolva o problema e produza a RESPOSTA FINAL consolidada, em português, bem organizada e pronta para ser colocada em um PDF. Use texto simples, sem tabelas nem markdown.';

// Uma chamada ao LLM (formato OpenAI). A chave nunca sai do backend.
async function chamarLLM(messages, maxTokens) {
  if (!llmApiKey || llmApiKey.startsWith('COLE_')) {
    throw new Error('Chave da IA não configurada. Defina LLM_API_KEY no .env.');
  }

  const resposta = await fetch(llmApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmApiKey}`,
    },
    body: JSON.stringify({ model: llmModel, max_tokens: maxTokens, temperature: 0.3, messages }),
  });

  if (!resposta.ok) {
    let detalhe = '';
    try {
      const j = await resposta.json();
      detalhe = j?.error?.message || JSON.stringify(j);
    } catch {
      detalhe = await resposta.text().catch(() => '');
    }
    const err = new Error(detalhe || `HTTP ${resposta.status}`);
    err.status = resposta.status;
    err.retryAfter = Number(resposta.headers.get('retry-after')) || null;
    throw err;
  }

  const dados = await resposta.json();
  const conteudo = dados.choices?.[0]?.message?.content;
  if (!conteudo) {
    throw new Error('Resposta da IA veio vazia.');
  }
  return { content: conteudo, totalTokens: dados.usage?.total_tokens || 0 };
}

// Chama o LLM tratando o limite de taxa (429) com espera e nova tentativa.
async function chamarLLMResiliente(messages, maxTokens, tentativas = 5) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await chamarLLM(messages, maxTokens);
    } catch (err) {
      if (err.status === 429 && i < tentativas - 1) {
        const esperaMs = (err.retryAfter || 20) * 1000 + 1000;
        console.log(`Limite de taxa atingido; aguardando ${Math.round(esperaMs / 1000)}s...`);
        await esperar(esperaMs);
        continue;
      }
      if (err.status === 413) {
        throw new Error('Um trecho ficou grande demais para o limite da IA. Reduza LLM_CHUNK_CHARS no .env.');
      }
      if (err.status === 401) {
        throw new Error('Chave da IA inválida. Verifique LLM_API_KEY no .env.');
      }
      throw new Error(err.message || 'Falha na chamada à IA.');
    }
  }
  throw new Error('Não foi possível concluir (excesso de tentativas por limite de taxa).');
}

// Divide o texto em pedaços de no máximo maxChars, respeitando parágrafos.
function dividirEmChunks(texto, maxChars) {
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
  return chunks;
}

// Espalha o uso ao longo do tempo para respeitar o limite de tokens por minuto.
async function pausarPorTokens(totalTokens) {
  const esperaMs = Math.ceil((totalTokens / TPM_LIMIT) * 60000 * 1.1);
  await esperar(esperaMs);
}

// Consolida os resumos em uma resposta final (recursivo se ainda for grande).
async function reduzir(resumos) {
  const combinado = resumos.join('\n\n');
  if (combinado.length > CHUNK_CHARS) {
    const grupos = dividirEmChunks(combinado, CHUNK_CHARS);
    const parciais = [];
    for (let i = 0; i < grupos.length; i++) {
      const { content, totalTokens } = await chamarLLMResiliente(
        [
          { role: 'system', content: PROMPT_MAP },
          { role: 'user', content: grupos[i] },
        ],
        1500
      );
      parciais.push(content);
      if (i < grupos.length - 1) await pausarPorTokens(totalTokens);
    }
    return reduzir(parciais);
  }

  const { content } = await chamarLLMResiliente(
    [
      { role: 'system', content: PROMPT_REDUCE },
      { role: 'user', content: combinado },
    ],
    llmMaxTokens
  );
  return content;
}

// Processa o texto do PDF, dividindo automaticamente se for grande.
async function chamarIA(textoDoPdf) {
  const chunks = dividirEmChunks(textoDoPdf, CHUNK_CHARS);

  // Documento pequeno: uma única chamada direta.
  if (chunks.length === 1) {
    const { content } = await chamarLLMResiliente(
      [
        { role: 'system', content: PROMPT_DIRETO },
        { role: 'user', content: textoDoPdf },
      ],
      llmMaxTokens
    );
    return content;
  }

  // Documento grande: resume cada trecho (map) e depois consolida (reduce).
  console.log(`Documento grande: processando em ${chunks.length} trechos...`);
  const resumos = [];
  for (let i = 0; i < chunks.length; i++) {
    const { content, totalTokens } = await chamarLLMResiliente(
      [
        { role: 'system', content: PROMPT_MAP },
        { role: 'user', content: `Trecho ${i + 1} de ${chunks.length}:\n\n${chunks[i]}` },
      ],
      1200
    );
    resumos.push(`--- Resumo do trecho ${i + 1} ---\n${content}`);
    console.log(`Trecho ${i + 1}/${chunks.length} pronto (${totalTokens} tokens).`);
    if (i < chunks.length - 1) await pausarPorTokens(totalTokens);
  }

  console.log('Consolidando a resposta final...');
  return reduzir(resumos);
}

// Substitui caracteres fora do Latin-1 (a fonte padrão do PDF não os suporta).
function sanitizeParaPdf(texto) {
  return texto
    .replace(/\r\n/g, '\n')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[→➔➙]/g, '->')
    .replace(/[•●▪]/g, '- ')
    .replace(/ /g, ' ')
    .replace(/[^\x00-\xFF]/g, '');
}

// Quebra o texto em linhas que cabem na página, respeitando quebras de parágrafo.
function quebrarTexto(texto, fonte, tamanho, larguraMax) {
  const linhas = [];
  for (const paragrafo of texto.split('\n')) {
    if (paragrafo.trim() === '') {
      linhas.push('');
      continue;
    }
    let linhaAtual = '';
    for (const palavra of paragrafo.split(/\s+/)) {
      const teste = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(teste, tamanho) > larguraMax && linhaAtual) {
        linhas.push(linhaAtual);
        linhaAtual = palavra;
      } else {
        linhaAtual = teste;
      }
    }
    if (linhaAtual) linhas.push(linhaAtual);
  }
  return linhas;
}

// Monta um PDF (Buffer) a partir do texto da resposta da IA.
async function gerarPdfResposta(textoResposta) {
  const texto = sanitizeParaPdf(textoResposta);
  const pdfDoc = await PDFDocument.create();
  const fonte = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const tamanhoFonte = 11;
  const alturaLinha = 16;
  const margem = 50;

  let pagina = pdfDoc.addPage();
  let { width, height } = pagina.getSize();
  const linhas = quebrarTexto(texto, fonte, tamanhoFonte, width - margem * 2);
  let y = height - margem;

  for (const linha of linhas) {
    if (y < margem) {
      pagina = pdfDoc.addPage();
      ({ width, height } = pagina.getSize());
      y = height - margem;
    }
    if (linha !== '') {
      pagina.drawText(linha, { x: margem, y, size: tamanhoFonte, font: fonte, color: rgb(0, 0, 0) });
    }
    y -= alturaLinha;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ---------- Pipeline: ficha de atendimento -> petição inicial (.docx) ----------
app.post('/api/peticao', upload.single('arquivo'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Envie a ficha de atendimento em PDF.' });
    const ehPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    if (!ehPdf) return res.status(400).json({ error: 'A ficha deve estar em PDF.' });

    const textoFicha = await extrairTextoPdf(file.buffer);
    if (!textoFicha) {
      return res.status(400).json({ error: 'Não foi possível ler o texto da ficha (PDF digitalizado/imagem?).' });
    }

    const { docx, avisos, resumo } = await gerarPeticaoDaFicha(textoFicha);

    // Persistência no Supabase é OPCIONAL: se o projeto estiver indisponível/pausado,
    // seguimos com o download direto (base64), sem bloquear a geração.
    let arquivoUrl = null;
    try {
      const timestamp = Date.now();
      const caminho = `peticoes/${timestamp}-peticao.docx`;
      const { error } = await supabase.storage.from(bucketName).upload(caminho, docx, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false,
      });
      if (!error) {
        const { data } = await supabase.storage.from(bucketName).createSignedUrl(caminho, 3600);
        arquivoUrl = data?.signedUrl || null;
      } else {
        console.warn('Supabase indisponível (petição segue por download direto):', error.message);
      }
    } catch (e) {
      console.warn('Supabase indisponível (petição segue por download direto):', e.message);
    }

    const primeiro = (resumo.reclamante || 'cliente').split(/\s+/)[0].toLowerCase();
    res.json({
      sucesso: true,
      docxBase64: docx.toString('base64'),
      filename: `peticao-${primeiro}.docx`,
      arquivo: arquivoUrl,
      avisos,
      resumo,
    });
  } catch (error) {
    console.error('Erro em /api/peticao:', error);
    res.status(500).json({ error: error.message || 'Falha ao gerar a petição.' });
  }
});

app.get('/api/last', async (req, res) => {
  try {
    const metadata = await getLatestMetadata();
    res.json(metadata || {});
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível ler dados.' });
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const metadata = await getLatestMetadata();
    if (!metadata || !metadata.objectPath) {
      return res.status(404).send('Nenhum arquivo para download');
    }

    const { data, error } = await supabase.storage.from(bucketName).download(metadata.objectPath);
    if (error) {
      console.error('Erro ao baixar arquivo:', error.message);
      return res.status(500).send('Erro ao baixar arquivo');
    }

    const filename = metadata.originalName || path.basename(metadata.objectPath);
    const mime = metadata.mimeType || 'application/octet-stream';
    const buffer = Buffer.from(await data.arrayBuffer());

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Erro no download:', error);
    res.status(500).send('Erro ao processar download');
  }
});

const server = app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
// Documentos grandes são processados em partes e podem levar minutos:
// desliga o timeout padrão de requisição para não cortar o processamento.
server.requestTimeout = 0;
