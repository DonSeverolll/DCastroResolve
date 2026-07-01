# DCastro Resolve

Site simples para captura de prompt ou arquivo e armazenamento em Supabase Storage.

## Como usar

1. Copie `.env.example` para `.env`.
2. Preencha `SUPABASE_URL` e `SUPABASE_KEY` com suas credenciais Supabase.
3. Opcional: ajuste `SUPABASE_BUCKET` se quiser usar outro bucket além de `uploads`.
4. Execute `npm install`.
5. Execute `npm start`.
6. Abra `http://localhost:3000`.

## Recursos

- Formulário de upload de arquivo (.pdf, .doc, .docx, .txt)
- Campo de texto para prompt
- Armazenamento em Supabase Storage
- Automação com Puppeteer para abrir `chatgpt.com` ou `gemini.google.com` e enviar dados

> Observação: o envio automático depende de login no site externo e dos elementos disponíveis na interface.
