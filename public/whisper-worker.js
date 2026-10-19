import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';

env.allowLocalModels = false;

let transcriber = null;
let currentModel = null;

self.addEventListener('message', async (event) => {
  const { type, audio, model = 'Xenova/whisper-tiny.en', language = 'english' } = event.data;

  if (type === 'load') {
    try {
      self.postMessage({ status: 'loading', message: `Loading Offline Whisper (${model})...` });
      transcriber = await pipeline('automatic-speech-recognition', model, {
        progress_callback: (prog) => {
          if (prog.status === 'progress') {
            self.postMessage({
              status: 'progress',
              file: prog.file,
              progress: Math.round(prog.progress || 0)
            });
          }
        }
      });
      currentModel = model;
      self.postMessage({ status: 'ready', model });
    } catch (err) {
      self.postMessage({ status: 'error', error: err.message });
    }
    return;
  }

  if (type === 'transcribe') {
    try {
      if (!transcriber || currentModel !== model) {
        self.postMessage({ status: 'loading', message: `Initializing ${model}...` });
        transcriber = await pipeline('automatic-speech-recognition', model);
        currentModel = model;
        self.postMessage({ status: 'ready', model });
      }

      const options = {
        chunk_length_s: 20,
        stride_length_s: 3,
        return_timestamps: false
      };

      if (!model.endsWith('.en')) {
        options.language = language;
        options.task = 'transcribe';
      }

      const output = await transcriber(audio, options);
      const text = (output?.text || '').trim();
      self.postMessage({
        status: 'complete',
        text,
        speaker: event.data.speaker || 'Meeting Audio'
      });
    } catch (err) {
      self.postMessage({ status: 'error', error: err.message });
    }
  }
});
