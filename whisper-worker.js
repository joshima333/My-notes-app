// Trascrizione 100% sul telefono con Whisper (nessun audio inviato a server).
// Da internet si scaricano solo libreria e modello (una volta, poi in cache).
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
env.allowLocalModels = false;

let asr = null, loaded = '';
self.onmessage = async ({ data: { id, audio, model } }) => {
  try {
    if (!asr || loaded !== model) {
      asr = await pipeline('automatic-speech-recognition', model, {
        dtype: 'q8', device: 'wasm',
        progress_callback: p => p.status === 'progress' && self.postMessage({ type: 'progress', progress: p.progress, file: p.file }),
      });
      loaded = model;
    }
    self.postMessage({ type: 'working', id });
    const out = await asr(audio, { language: 'italian', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    self.postMessage({ type: 'done', id, text: out.text.trim() });
  } catch (e) {
    self.postMessage({ type: 'error', id, error: String(e.message || e) });
  }
};
