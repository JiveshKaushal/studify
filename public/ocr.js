// OCR for scanned PDFs, run in the visitor's browser with tesseract.js (nothing is sent to an OCR service).
import { loadPdfJs } from './visuals.js';

const SCALE = 2.5; // about 180 dpi: a good balance of accuracy and speed

export async function ocrPdf(url, { maxPages = 10, onProgress = () => {} } = {}) {
  const [tesseract, pdfjs] = await Promise.all([import('/vendor/tesseract/tesseract.esm.min.js'), loadPdfJs()]);
  const { createWorker } = tesseract.default || tesseract; // the bundle only has a default export
  onProgress({ stage: 'Loading the OCR engine…', fraction: 0 });
  let pageNo = 0;
  let total = 0;
  const worker = await createWorker('eng', 1, {
    workerPath: '/vendor/tesseract/worker.min.js',
    corePath: '/vendor/tesseract-core',
    langPath: '/vendor/tessdata',
    gzip: true,
    logger: m => {
      if (m.status === 'recognizing text' && total) onProgress({ stage: `Reading page ${pageNo} of ${total}…`, fraction: (pageNo - 1 + m.progress) / total });
    },
  });
  try {
    const doc = await pdfjs.getDocument({ url: '/api/pdf?url=' + encodeURIComponent(url), isEvalSupported: false }).promise;
    total = Math.min(doc.numPages, maxPages);
    const pages = [];
    for (pageNo = 1; pageNo <= total; pageNo++) {
      onProgress({ stage: `Reading page ${pageNo} of ${total}…`, fraction: (pageNo - 1) / total });
      const page = await doc.getPage(pageNo);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
      const lines = [];
      for (const block of data.blocks || []) for (const para of block.paragraphs) for (const line of para.lines) {
        const text = line.text.replace(/\s+/g, ' ').trim();
        if (!text || line.confidence < 45) continue;
        const height = line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0;
        lines.push({ text, size: Math.round(height / 2) * 2, y: -line.bbox.y0 });
      }
      pages.push({ number: pageNo, height: canvas.height, lines });
      page.cleanup();
    }
    onProgress({ stage: 'Writing notes…', fraction: 1 });
    return { pages, totalPages: doc.numPages };
  } finally {
    await worker.terminate();
  }
}
