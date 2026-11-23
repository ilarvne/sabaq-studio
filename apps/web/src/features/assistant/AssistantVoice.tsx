import { matchingLocalVoice } from '@sabaq/lesson/narration';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DownloadSimpleIcon, MicrophoneIcon, SpeakerHighIcon, SpinnerGapIcon, StopIcon } from '@phosphor-icons/react';
import type { Locale } from '@sabaq/lesson/types';
import { Button } from '@/components/coss/button';
import { cn } from '@/lib/utils';
import './assistant-voice.css';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle, DialogTrigger } from '@/components/coss/dialog';

import { canRecordForAlem, startAlemRecording } from './alem-dictation';
import { dictationOptions, languageTag, onDeviceRecognition, voiceCopy, type Availability } from './on-device-speech';

const VoiceContext = createContext<{
  voices: readonly SpeechSynthesisVoice[];
  alem: boolean;
  claim(stop: () => void): () => void;
} | null>(null);

export function AssistantVoiceProvider({ children, locale, alem }: { children: ReactNode; locale: Locale; alem: boolean }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const current = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const synthesis = window.speechSynthesis;
    if (!synthesis || typeof window.SpeechSynthesisUtterance !== 'function') return;
    const refresh = () => setVoices(synthesis.getVoices().filter(voice => voice.localService === true));
    refresh();
    synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, []);
  useEffect(() => () => current.current?.(), [locale]);

  function claim(stop: () => void) {
    current.current?.();
    current.current = stop;
    return () => { if (current.current === stop) current.current = undefined; };
  }

  return <VoiceContext.Provider value={{voices, claim, alem}}>{children}</VoiceContext.Provider>;
}

function messageLanguage(text: string, fallback: Locale): Locale {
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  if (latin > cyrillic) return 'en';
  if (cyrillic > latin) return /[ӘәҒғҚқҢңӨөҰұҮүҺһІі]/u.test(text) || fallback === 'kk' ? 'kk' : 'ru';
  return fallback;
}

function voiceChunks(text: string, lecture=false): string[] {
  const plain = lecture ? text.trim() : text.replace(/!?\[([^\]\n]+)\]\([^\n)]+\)/gu, '$1').replace(/https?:\/\/\S+/gu, ' ')
    .replace(/^[\t ]*([#>]+|[-*])\s+/gmu, '').replace(/[*_`]/gu, '').trim();
  const chunks: string[] = [];
  for (const word of plain.split(/\s+/u)) {
    if (!word) continue;
    const last = chunks.at(-1);
    if (!last || last.length + word.length > 210) chunks.push(word);
    else chunks[chunks.length - 1] = last + ' ' + word;
  }
  return chunks;
}

export function AssistantReadAloud({ text, locale, language, disabled, lecture }: {
  lecture?:{listen:string;unavailable:string};
  text: string;
  locale: Locale;
  language?: Locale;
  disabled?: boolean;
}) {
  const provider = useContext(VoiceContext);
  const stopReading = useRef<(() => void) | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const replyLanguage = language ?? messageLanguage(text, locale);
  const voice = matchingLocalVoice(provider?.voices ?? [],replyLanguage);
  useEffect(() => () => stopReading.current?.(), [text, voice?.voiceURI]);
  if (!voice || !provider || !text.trim()) return lecture ? <>
    <Button variant="outline" size="sm" disabled><SpeakerHighIcon aria-hidden/>{lecture.listen}</Button>
    {(!voice || !provider) && <p role="status">{lecture.unavailable}</p>}
  </> : null;
  const t = voiceCopy[locale];

  function read() {
    if (stopReading.current) {
      stopReading.current();
      return;
    }
    if (!provider || !voice) return;
    const selectedVoice = voice;
    const chunks = voiceChunks(text,Boolean(lecture));
    if (chunks.length === 0) return;
    const synthesis = window.speechSynthesis;
    let utterance: SpeechSynthesisUtterance | undefined;
    let index = 0;
    let startupTimer:number|undefined;
    let release: (() => void) | undefined;
    function finish() {
      if (stopReading.current !== stop) return;
      stopReading.current = undefined;
      window.clearTimeout(startupTimer);
      if (utterance) {
        utterance.onend = null;
        utterance.onerror = null;
      }
      release?.();
      setReading(false);
    }
    function stop() {
      finish();
      synthesis.cancel();
    }
    function next() {
      if (stopReading.current !== stop) return;
      const phrase = chunks[index++];
      if (!phrase) {
        finish();
        return;
      }
      const chunk = new SpeechSynthesisUtterance(phrase);
      utterance = chunk;
      const installed=synthesis.getVoices().find(item=>item.localService===true && item.voiceURI===selectedVoice.voiceURI && item.lang===selectedVoice.lang);
      if(!installed) {finish();setFailed(true);return;}
      chunk.voice = installed;
      chunk.lang = selectedVoice.lang;
      chunk.onstart=()=>window.clearTimeout(startupTimer);
      chunk.onend = next;
      chunk.onerror = () => {
        finish();
        setFailed(true);
      };
      try {
        synthesis.speak(chunk);
      } catch {
        finish();
        setFailed(true);
      }
    }
    release = provider.claim(stop);
    stopReading.current = stop;
    setFailed(false);
    setReading(true);
    if(lecture) startupTimer=window.setTimeout(()=>{stop();setFailed(true);},10_000);
    next();
  }

  const label = reading ? t.stopReading : lecture?.listen ?? t.read;
  return <>
    <Button variant={lecture ? "outline" : "ghost"} size={lecture ? "sm" : "icon-xs"} onClick={read} disabled={!reading && disabled} aria-label={label} title={label}>
      {reading ? <StopIcon aria-hidden /> : <SpeakerHighIcon aria-hidden />}{lecture && label}
    </Button>
    {failed && <span role="status" className={lecture ? undefined : "sr-only"}>{t.readingFailed}</span>}
  </>;
}

export function AlemDictation({ locale, language, disabled, className, onTranscript, onActive }: {
  locale: Locale;
  language: Locale;
  disabled?: boolean;
  className?: string;
  onTranscript(text: string): void;
  onActive?(active: boolean): void;
}) {
  const voice = useContext(VoiceContext);
  const [phase, setPhase] = useState<'starting' | 'recording' | 'processing'>();
  const [notice, setNotice] = useState('');
  const session = useRef<{ cancel(): void; stop(): void } | undefined>(undefined);
  const callbacks = useRef({ onTranscript, onActive });
  const t = voiceCopy[locale];

  useEffect(() => { callbacks.current = { onTranscript, onActive }; }, [onTranscript, onActive]);
  useEffect(() => () => session.current?.cancel(), [language]);
  useEffect(() => { if (disabled) session.current?.cancel(); }, [disabled]);

  if (!canRecordForAlem()) return null;

  function toggle() {
    if (session.current) {
      if (phase === 'recording') session.current.stop();
      else session.current.cancel();
      return;
    }
    let release: (() => void) | undefined;
    const recording = startAlemRecording(language, {
      start: () => setPhase('recording'),
      processing: () => setPhase('processing'),
      complete(text) { finish(); callbacks.current.onTranscript(text); },
      fail(denied) { finish(); setNotice(denied ? t.micDenied : t.transcriptionFailed); },
    });
    function finish() {
      session.current = undefined;
      release?.();
      setPhase(undefined);
      callbacks.current.onActive?.(false);
    }
    function cancel() { recording.cancel(); finish(); }
    release = voice?.claim(cancel);
    session.current = { stop: recording.stop, cancel };
    setNotice('');
    setPhase('starting');
    callbacks.current.onActive?.(true);
  }

  const waiting = phase === 'starting' || phase === 'processing';
  const label = phase === 'processing' ? t.cancelTranscription : phase ? t.stopDictating : t.alemDictate;
  const status = phase === 'starting' ? t.starting : phase === 'recording' ? t.recording : phase === 'processing' ? t.transcribing : notice;
  return <>
    <Button variant={phase ? 'secondary' : 'ghost'} size="icon-sm" className={cn('composer-voice',className)}
      onClick={toggle} disabled={disabled} data-voice-phase={phase ?? 'idle'} aria-busy={waiting} aria-label={label} title={label}>
      {waiting ? <SpinnerGapIcon aria-hidden className="composer-voice-spin"/>
        : phase === 'recording' ? <StopIcon aria-hidden weight="fill"/> : <MicrophoneIcon aria-hidden/>}
    </Button>
    {status && <span role={notice ? 'alert' : 'status'} className="sr-only">{status}</span>}
  </>;
}

export function AssistantDictation({ locale, onTranscript, disabled }: {
  locale: Locale;
  onTranscript(text: string): void;
  disabled?: boolean;
}) {
  const provider = useContext(VoiceContext);
  const [availability, setAvailability] = useState<Availability>('unavailable');
  const [phase, setPhase] = useState<'starting' | 'listening' | 'finishing'>();
  const [notice, setNotice] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const session = useRef<{ cancel(): void; stop(): void } | undefined>(undefined);
  const generation = useRef(0);
  const transcript = useRef(onTranscript);
  const t = voiceCopy[locale];
  useEffect(() => { transcript.current = onTranscript; }, [onTranscript]);
  useEffect(() => {
    if (disabled) session.current?.cancel();
  }, [disabled]);
  useEffect(() => {
    let active = true;
    setAvailability('unavailable');
    setSetupOpen(false);
    setDownloading(false);
    setNotice('');
    const recognition = onDeviceRecognition();
    const refresh = () => {
      if (!recognition) return;
      void Promise.resolve().then(() => recognition.available(dictationOptions(locale)))
        .then(value => { if (active) setAvailability(value); })
        .catch(() => { if (active) setAvailability('unavailable'); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      generation.current++;
      window.removeEventListener('focus', refresh);
      session.current?.cancel();
    };
  }, [locale]);

  async function download() {
    const recognition = onDeviceRecognition();
    if (!recognition?.install || downloading) return;
    setDownloading(true);
    setNotice('');
    const request = generation.current;
    try {
      const options = dictationOptions(locale);
      if (!await recognition.install(options)) throw new Error('Language pack setup declined');
      const status = await recognition.available(options);
      if (request === generation.current) {
        setAvailability(status);
        setSetupOpen(false);
      }
    } catch {
      if (request === generation.current) setNotice(t.downloadFailed);
    } finally {
      if (request === generation.current) setDownloading(false);
    }
  }

  function dictate() {
    if (session.current) {
      if (phase === 'starting') session.current.cancel();
      else if (phase === 'listening') session.current.stop();
      return;
    }
    const Recognition = onDeviceRecognition();
    if (availability !== 'available' || !Recognition || !provider) return;
    const recognition = new Recognition();
    recognition.processLocally = true;
    if (recognition.processLocally !== true) return;
    if ('quality' in recognition) recognition.quality = 'dictation';
    recognition.lang = languageTag[locale];
    recognition.interimResults = false;
    recognition.continuous = true;
    const release = provider.claim(() => local.cancel());
    let consumed = 0;
    function finish() {
      if (session.current !== local) return;
      recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null;
      session.current = undefined;
      release();
      setPhase(undefined);
    }
    const local = {
      cancel() {
        finish();
        recognition.abort();
      },
      stop() {
        setPhase('finishing');
        recognition.stop();
      },
    };
    recognition.onstart = () => setPhase('listening');
    recognition.onend = finish;
    recognition.onerror = ({error}) => {
      finish();
      setNotice(['not-allowed', 'service-not-allowed'].includes(error) ? t.micDenied : t.dictationFailed);
    };
    recognition.onresult = event => {
      const phrases: string[] = [];
      for (let index = Math.max(consumed, event.resultIndex); index < event.results.length; index++) {
        const result = event.results[index];
        if (!result.isFinal) break;
        phrases.push(result[0].transcript.trim());
        consumed = index + 1;
      }
      const words = phrases.filter(Boolean).join(' ');
      if (words) transcript.current(words);
    };
    session.current = local;
    setNotice('');
    setPhase('starting');
    try {
      recognition.start();
    } catch {
      finish();
      setNotice(t.dictationFailed);
    }
  }

  if (!provider) return null;
  const remote = provider.alem && <AlemDictation locale={locale} language={locale} disabled={disabled} onTranscript={onTranscript}/>;
  if (availability === 'downloadable' && onDeviceRecognition()?.install) {
    return <><Dialog open={setupOpen} onOpenChange={setSetupOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" disabled={disabled} />} aria-label={t.setup} title={t.setup}>
        <DownloadSimpleIcon aria-hidden />
      </DialogTrigger>
      <DialogPopup closeProps={{'aria-label':t.close}}>
        <DialogHeader><DialogTitle>{t.setup}</DialogTitle><DialogDescription>{t.downloadDescription}</DialogDescription></DialogHeader>
        {notice && <p role="alert" className="px-4 text-sm">{notice}</p>}
        <DialogFooter><Button disabled={downloading} onClick={() => void download()}>{downloading ? t.downloading : t.download}</Button></DialogFooter>
      </DialogPopup>
    </Dialog>{remote}</>;
  }
  if (availability !== 'available') return remote;
  const label = phase ? t.stopDictating : t.dictate;
  const status = phase === 'starting' ? t.starting : phase === 'listening' ? t.listening : phase === 'finishing' ? t.finishing : notice;
  return <>
    <Button variant={phase ? 'secondary' : 'ghost'} size="icon-sm" className="composer-voice" onClick={dictate}
      data-voice-phase={phase ?? 'idle'} aria-busy={phase === 'starting' || phase === 'finishing'}
      disabled={phase === 'finishing' || (!phase && disabled)} aria-label={label} title={label}>
      {phase === 'starting' || phase === 'finishing' ? <SpinnerGapIcon aria-hidden className="composer-voice-spin"/>
        : phase === 'listening' ? <StopIcon aria-hidden weight="fill"/> : <MicrophoneIcon aria-hidden/>}
    </Button>
    {status && <span role="status" className="sr-only">{status}</span>}
  </>;
}
