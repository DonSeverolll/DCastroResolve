const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
const puppeteer = require('puppeteer');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const bucketName = process.env.SUPABASE_BUCKET || 'uploads';

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
    await sendToAssistant(prompt, file);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno ao processar os dados.' });
  }
});

async function sendToAssistant(prompt, file) {
  const target = 'chatgpt.com';
  const url = `https://${target}`;

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });

  if (target.includes('chatgpt.com')) {
    const text = prompt || (file ? `${file.originalname}` : 'Arquivo enviado.');
    console.log(`Tentando enviar texto para ${target}: ${text}`);
    await page.waitForTimeout(4000);
  }

  await browser.close();
}

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

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
