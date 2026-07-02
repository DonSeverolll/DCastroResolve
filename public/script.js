const form = document.getElementById('uploadForm');
const status = document.getElementById('status');
const fileInput = document.getElementById('fileUpload');
const fileTrigger = document.querySelector('.file-trigger');
const fileName = document.getElementById('fileName');
const downloadInfo = document.getElementById('downloadInfo');
const submitButton = form.querySelector('button[type="submit"]');

const allowedTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const maxFileSize = 10 * 1024 * 1024; // 10 MB

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const file = fileInput.files[0];
  if (file) {
    if (!allowedTypes.includes(file.type)) {
      status.textContent = 'Tipo de arquivo inválido. Use PDF, DOC, DOCX ou TXT.';
      return;
    }
    if (file.size > maxFileSize) {
      status.textContent = 'O arquivo é muito grande. O limite é 10 MB.';
      return;
    }
  }

  status.textContent = 'Enviando...';
  submitButton.disabled = true;
  submitButton.textContent = 'Enviando...';

  const formData = new FormData(form);

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (response.ok) {
      status.textContent = 'Dados enviados e armazenados com sucesso.';
      form.reset();
      fileName.textContent = 'Nenhum arquivo selecionado';
      await fetchLast();
    } else {
      status.textContent = result.error || 'Erro ao enviar os dados.';
    }
  } catch (error) {
    status.textContent = 'Falha de conexão. Tente novamente.';
    console.error(error);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Enviar e armazenar';
  }
});

// File input trigger and display
if (fileTrigger && fileInput) {
  fileTrigger.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    fileName.textContent = f ? f.name : 'Nenhum arquivo selecionado';
  });
}

// Fetch last uploaded document and show download link
async function fetchLast() {
  try {
    const res = await fetch('/api/last');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.objectPath) {
      downloadInfo.textContent = 'Nenhum arquivo enviado ainda.';
      return;
    }

    if (data.type === 'file') {
      const name = data.originalName || 'arquivo';
      downloadInfo.innerHTML = `Arquivo: ${name} <a class="button button--outline download-link" href="/api/download">Baixar</a>`;
    } else if (data.prompt) {
      downloadInfo.innerHTML = `Último prompt salvo: <pre style="white-space:pre-wrap">${escapeHtml(data.prompt)}</pre>`;
    } else {
      downloadInfo.textContent = 'Nenhum arquivo enviado ainda.';
    }
  } catch (err) {
    console.error('fetchLast error', err);
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>\"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Load last on start
fetchLast();

// ---------- Fluxo de IA: enviar PDF e receber PDF processado ----------
const iaForm = document.getElementById('iaForm');
const iaFile = document.getElementById('iaFile');
const iaFileName = document.getElementById('iaFileName');
const iaStatus = document.getElementById('iaStatus');
const iaResult = document.getElementById('iaResult');
const iaTrigger = document.querySelector('.ia-file-trigger');

if (iaTrigger && iaFile) {
  iaTrigger.addEventListener('click', () => iaFile.click());
  iaFile.addEventListener('change', () => {
    const f = iaFile.files[0];
    iaFileName.textContent = f ? f.name : 'Nenhum arquivo selecionado';
  });
}

if (iaForm) {
  iaForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const file = iaFile.files[0];
    if (!file) {
      iaStatus.textContent = 'Selecione um PDF primeiro.';
      return;
    }
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      iaStatus.textContent = 'O arquivo precisa ser um PDF.';
      return;
    }

    const iaSubmit = iaForm.querySelector('button[type="submit"]');
    iaStatus.textContent =
      'Processando com a IA... documentos grandes são feitos em partes e podem levar alguns minutos. Aguarde.';
    iaResult.style.display = 'none';
    iaSubmit.disabled = true;
    iaSubmit.textContent = 'Processando...';

    const formData = new FormData();
    formData.append('arquivo', file);

    try {
      const response = await fetch('/api/processar', { method: 'POST', body: formData });
      const result = await response.json();

      if (response.ok && result.sucesso) {
        iaStatus.textContent = 'Pronto! PDF gerado com sucesso.';
        const reticencias = result.preview && result.preview.length >= 500 ? '…' : '';
        iaResult.style.display = 'block';
        iaResult.innerHTML =
          '<h4>Resultado</h4>' +
          (result.preview ? `<pre style="white-space:pre-wrap">${escapeHtml(result.preview)}${reticencias}</pre>` : '') +
          `<a class="button button--outline download-link" href="${result.arquivo}" target="_blank" rel="noopener">Baixar PDF processado</a>`;
        iaForm.reset();
        iaFileName.textContent = 'Nenhum arquivo selecionado';
      } else {
        iaStatus.textContent = result.error || 'Erro ao processar o arquivo.';
      }
    } catch (error) {
      iaStatus.textContent = 'Falha de conexão. Tente novamente.';
      console.error(error);
    } finally {
      iaSubmit.disabled = false;
      iaSubmit.textContent = 'Processar com IA';
    }
  });
}
