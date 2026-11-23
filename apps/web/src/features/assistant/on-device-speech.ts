import { useEffect, useState } from 'react';
import type { DictationAdapter } from '@assistant-ui/react';
import type { Locale } from '@sabaq/lesson/types';

export const languageTag = { en: 'en-US', ru: 'ru-RU', kk: 'kk-KZ' } satisfies Record<Locale, string>;
export const voiceCopy = {
  en: {
    read: 'Read aloud', stopReading: 'Stop reading', readingFailed: 'Read-aloud could not start on this device.',
    dictate: 'Dictate on this device', stopDictating: 'Stop dictating', starting: 'Starting the microphone…',
    alemDictate: 'Dictate using online transcription', cancelTranscription: 'Cancel transcription', recording: 'Recording…', transcribing: 'Transcribing audio…',
    transcriptionFailed: 'Could not transcribe the recording. Try dictating again.',
    listening: 'Listening on this device…', finishing: 'Finishing dictation…',
    micDenied: 'Allow microphone access in your browser to dictate.', dictationFailed: 'Dictation could not start on this device.',
    setup: 'Set up on-device dictation', download: 'Download language pack', downloading: 'Downloading…',
    downloadDescription: 'Your browser will download a speech language pack. Dictation processes recordings on this device.',
    downloadFailed: 'The language pack could not be downloaded.', close: 'Close',
  },
  ru: {
    read: 'Прочитать вслух', stopReading: 'Остановить чтение', readingFailed: 'Не удалось запустить чтение вслух на этом устройстве.',
    dictate: 'Диктовать на этом устройстве', stopDictating: 'Остановить диктовку', starting: 'Включаем микрофон…',
    alemDictate: 'Диктовать с онлайн-распознаванием', cancelTranscription: 'Отменить распознавание', recording: 'Запись…', transcribing: 'Распознаём речь…',
    transcriptionFailed: 'Не удалось распознать запись. Попробуйте продиктовать ещё раз.',
    listening: 'Слушаем на этом устройстве…', finishing: 'Завершаем диктовку…',
    micDenied: 'Разрешите доступ к микрофону в браузере, чтобы диктовать.', dictationFailed: 'Не удалось запустить диктовку на этом устройстве.',
    setup: 'Настроить диктовку на устройстве', download: 'Скачать языковой пакет', downloading: 'Скачиваем…',
    downloadDescription: 'Браузер скачает языковой пакет. Диктовка будет обрабатывать звук на этом устройстве.',
    downloadFailed: 'Не удалось скачать языковой пакет.', close: 'Закрыть',
  },
  kk: {
    read: 'Дауыстап оқу', stopReading: 'Оқуды тоқтату', readingFailed: 'Бұл құрылғыда дауыстап оқу іске қосылмады.',
    dictate: 'Осы құрылғыда диктант жасау', stopDictating: 'Диктантты тоқтату', starting: 'Микрофон іске қосылуда…',
    alemDictate: 'Сөйлеуді онлайн тану', cancelTranscription: 'Сөйлеуді танудан бас тарту', recording: 'Жазылып жатыр…', transcribing: 'Сөйлеу танылып жатыр…',
    transcriptionFailed: 'Жазбадағы сөйлеу танылмады. Қайта айтып көріңіз.',
    listening: 'Осы құрылғыда тыңдап тұр…', finishing: 'Диктант аяқталуда…',
    micDenied: 'Диктант жасау үшін браузерде микрофонға рұқсат беріңіз.', dictationFailed: 'Бұл құрылғыда диктант іске қосылмады.',
    setup: 'Құрылғыдағы диктантты баптау', download: 'Тіл пакетін жүктеу', downloading: 'Жүктелуде…',
    downloadDescription: 'Браузер сөйлеуге арналған тіл пакетін жүктейді. Дыбыс осы құрылғыда өңделеді.',
    downloadFailed: 'Тіл пакеті жүктелмеді.', close: 'Жабу',
  },
};

export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
type LocalOptions = { langs: string[]; processLocally: true; quality: 'dictation' };
type LocalRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  quality?: 'dictation';
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionType = {
  new(): LocalRecognition;
  available(options: LocalOptions): Promise<Availability>;
  install?(options: LocalOptions): Promise<boolean>;
};

export function onDeviceRecognition(): RecognitionType | undefined {
  if (!window.isSecureContext) return;
  const browser = window as Window & { SpeechRecognition?: RecognitionType; webkitSpeechRecognition?: RecognitionType };
  const recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  // Ordinary SpeechRecognition can route recordings through the browser vendor.
  if (typeof recognition?.available !== 'function' || !('processLocally' in recognition.prototype)) return;
  return recognition;
}

export function dictationOptions(locale: Locale): LocalOptions {
  return {langs: [languageTag[locale]], processLocally: true, quality: 'dictation'};
}

function listeners<T extends unknown[]>() {
  const callbacks = new Set<(...args: T) => void>();
  return {
    subscribe(callback: (...args: T) => void) {
      callbacks.add(callback);
      return () => { callbacks.delete(callback); };
    },
    emit(...value: T) { for (const callback of callbacks) callback(...value); },
  };
}

function localSession(Recognition: RecognitionType, locale: Locale): DictationAdapter.Session {
  const recognition = new Recognition();
  const start = listeners<[]>();
  const speech = listeners<[DictationAdapter.Result]>();
  const end = listeners<[DictationAdapter.Result]>();
  let resolveEnd: () => void;
  const ended = new Promise<void>(resolve => { resolveEnd = resolve; });
  let stopTimeout: ReturnType<typeof setTimeout> | undefined;
  let finalIndex = 0;
  let finalText = '';
  const t = voiceCopy[locale];
  const session: DictationAdapter.Session = {
    status: {type: 'starting'},
    onSpeechStart: start.subscribe, onSpeech: speech.subscribe, onSpeechEnd: end.subscribe,
    stop() {
      if (session.status.type !== 'ended' && !stopTimeout) {
        stopTimeout = setTimeout(() => session.cancel(), 2500);
        try { recognition.stop(); } catch { session.cancel(); }
      }
      return ended;
    },
    cancel() {
      if (session.status.type === 'ended') return;
      finish({type: 'ended', reason: 'cancelled'});
      recognition.abort();
    },
  };

  function finish(status: Extract<DictationAdapter.Status, {type: 'ended'}>) {
    if (session.status.type === 'ended') return;
    session.status = status;
    clearTimeout(stopTimeout);
    recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null;
    end.emit({transcript: finalText, isFinal: true});
    resolveEnd();
  }

  recognition.onstart = () => { session.status = {type: 'running'}; start.emit(); };
  recognition.onresult = event => {
    const interim: string[] = [];
    for (let index = finalIndex; index < event.results.length; index++) {
      const result = event.results[index];
      const transcript = result[0].transcript.trim();
      if (result.isFinal) {
        finalIndex = index + 1;
        if (transcript) {
          finalText = [finalText, transcript].filter(Boolean).join(' ');
          speech.emit({transcript, isFinal: true});
        }
      } else interim.push(transcript);
    }
    speech.emit({transcript: interim.join(' '), isFinal: false});
  };
  recognition.onerror = ({error}) => finish({
    type: 'ended', reason: 'error', error: ['not-allowed', 'service-not-allowed'].includes(error) ? t.micDenied : t.dictationFailed,
  });
  recognition.onend = () => finish({type: 'ended', reason: 'stopped'});
  try {
    recognition.processLocally = true;
    if (!recognition.processLocally) throw new Error(t.dictationFailed);
    recognition.lang = languageTag[locale];
    if ('quality' in recognition) recognition.quality = 'dictation';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.start();
  } catch {
    finish({type: 'ended', reason: 'error', error: t.dictationFailed});
  }
  return session;
}

export function useOnDeviceDictation(locale: Locale) {
  const [available, setAvailable] = useState<{ locale: Locale; adapter: DictationAdapter }>();
  useEffect(() => {
    const Recognition = onDeviceRecognition();
    if (!Recognition) return;
    let active = true;
    let current: DictationAdapter.Session | undefined;
    const adapter: DictationAdapter = {
      listen() {
        current?.cancel();
        current = localSession(Recognition, locale);
        return current;
      },
    };
    let check = 0;
    const refresh = async () => {
      const request = ++check;
      try {
        const status = await Recognition.available(dictationOptions(locale));
        if (!active || check !== request) return;
        if (status !== 'available') current?.cancel();
        setAvailable(status === 'available' ? {locale, adapter} : undefined);
      } catch {
        if (!active || check !== request) return;
        current?.cancel();
        setAvailable(undefined);
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      current?.cancel();
    };
  }, [locale]);
  return available?.locale === locale ? available.adapter : undefined;
}
