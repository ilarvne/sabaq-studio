import type { Locale } from '@sabaq/lesson/types';

const formats = [
  { mime: 'audio/webm;codecs=opus', extension: 'webm' },
  { mime: 'audio/ogg;codecs=opus', extension: 'ogg' },
  { mime: 'audio/mp4', extension: 'mp4' },
];
const sizeLimit = 4_000_000;

function recordingFormat() {
  if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return;
  return formats.find(({ mime }) => MediaRecorder.isTypeSupported(mime));
}

export function canRecordForAlem() {
  return Boolean(recordingFormat());
}

type Events = {
  start(): void;
  processing(): void;
  complete(text: string): void;
  fail(denied: boolean): void;
};

export function startAlemRecording(language: Locale, events: Events) {
  const controller = new AbortController();
  const chunks: Blob[] = [];
  const format = recordingFormat();
  let bytes = 0;
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  function cleanup() {
    finished = true;
    clearTimeout(timer);
    controller.abort();
    if (recorder) {
      recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    stream?.getTracks().forEach(track => track.stop());
    chunks.length = 0;
  }

  function fail(denied = false) {
    if (finished) return;
    cleanup();
    events.fail(denied);
  }

  async function transcribe() {
    if (!format || finished) return;
    stream?.getTracks().forEach(track => track.stop());
    if (!bytes) return fail();
    events.processing();
    try {
      const response = await fetch(`/api/media/transcriptions/${language}?format=${format.extension}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob(chunks),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(105_000)]),
      });
      if (!response.ok) throw new Error('Transcription request failed');
      const { text } = await response.json();
      if (typeof text !== 'string' || !text.trim()) throw new Error('No speech detected');
      if (finished) return;
      cleanup();
      events.complete(text.trim());
    } catch {
      fail();
    }
  }

  function stop() {
    clearTimeout(timer);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  void (async () => {
    // Let the composer subscribe before a capability or permission failure is reported.
    await Promise.resolve();
    if (finished) return;
    if (!format) return fail();
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      if (finished) {
        microphone.getTracks().forEach(track => track.stop());
        return;
      }
      stream = microphone;
      recorder = new MediaRecorder(stream, { mimeType: format.mime, audioBitsPerSecond: 64_000 });
      recorder.ondataavailable = ({ data }) => {
        bytes += data.size;
        if (bytes > sizeLimit) return fail();
        if (data.size) chunks.push(data);
      };
      recorder.onerror = () => fail();
      recorder.onstop = () => void transcribe();
      recorder.start(1000);
      timer = setTimeout(stop, 60_000);
      events.start();
    } catch (error) {
      fail(error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name));
    }
  })();

  return { stop, cancel: cleanup };
}
