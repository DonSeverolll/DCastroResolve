// Fluxo: envia a ficha (PDF) -> pipeline gera a petição (.docx) -> download + resumo.
const form = document.getElementById('peticaoForm');
const fichaInput = document.getElementById('fichaFile');
const fichaName = document.getElementById('fichaName');
const status = document.getElementById('peticaoStatus');
const result = document.getElementById('peticaoResult');
const trigger = document.querySelector('.ficha-trigger');
const submitBtn = form.querySelector('button[type="submit"]');

if (trigger && fichaInput) {
  trigger.addEventListener('click', () => fichaInput.click());
  fichaInput.addEventListener('change', () => {
    const f = fichaInput.files[0];
    fichaName.textContent = f ? f.name : 'Nenhum arquivo selecionado';
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const file = fichaInput.files[0];
  if (!file) {
    status.textContent = 'Selecione a ficha de atendimento (PDF).';
    return;
  }
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    status.textContent = 'A ficha precisa ser um PDF.';
    return;
  }

  status.textContent = 'Lendo a ficha e montando a petição... isso pode levar alguns segundos.';
  result.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Gerando...';

  const formData = new FormData();
  formData.append('arquivo', file);

  try {
    const response = await fetch('/api/peticao', { method: 'POST', body: formData });
    const data = await response.json();

    if (response.ok && data.sucesso) {
      status.textContent = 'Petição gerada com sucesso!';
      result.style.display = 'block';
      result.innerHTML = montarResultado(data);
    } else {
      status.textContent = data.error || 'Erro ao gerar a petição.';
    }
  } catch (err) {
    status.textContent = 'Falha de conexão. Tente novamente.';
    console.error(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Gerar petição';
  }
});

function montarResultado(data) {
  const r = data.resumo || {};
  const teses = (r.blocosGerados || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const avisos = (data.avisos || []).map((a) => `<li>${escapeHtml(a)}</li>`).join('');
  const filename = data.filename || 'peticao.docx';
  const href = data.arquivo
    ? data.arquivo
    : 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' + data.docxBase64;
  return (
    '<h4>Petição gerada</h4>' +
    `<p><strong>Reclamante:</strong> ${escapeHtml(r.reclamante || '—')}</p>` +
    `<p><strong>Reclamadas:</strong> ${escapeHtml((r.reclamadas || []).join('; ') || '—')}</p>` +
    (teses ? `<p><strong>Teses incluídas (do modelo):</strong></p><ul>${teses}</ul>` : '') +
    (avisos
      ? `<p><strong>⚠️ Matérias sem modelo — não geradas (para não inventar):</strong></p><ul>${avisos}</ul>`
      : '') +
    `<a class="button button--primary download-link" href="${href}" download="${filename}">Baixar petição (.docx)</a>`
  );
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
