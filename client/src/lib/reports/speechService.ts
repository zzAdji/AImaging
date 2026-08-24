/**
 * SpeechService — saisie vocale (INSTRUCTIONS.md §18/§19/§21).
 *
 * Pipeline privilégié : MICRO → enregistrement (MediaRecorder) → transcription
 * via GEMINI (endpoint serveur /voice/transcribe). Si le mode micro/Gemini est
 * indisponible (pas de mediaDevices, serveur éteint…), repli sur Web Speech API
 * lorsqu'elle existe. La transcription est TOUJOURS proposée par l'appelant
 * (preview puis confirmation) — jamais appliquée directement.
 */

import { transcribeAudio } from "../workspaceApi";

export type SpeechState = "idle" | "listening" | "processing" | "unsupported";

export interface SpeechEvents {
  onStateChange?: (state: SpeechState) => void;
  /** Transcription finale (résultat définitif du provider). */
  onTranscript?: (text: string) => void;
  onError?: (message: string) => void;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  const w = globalThis as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  const win = (globalThis as Record<string, unknown>).window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition
    ?? w.webkitSpeechRecognition
    ?? (win !== undefined && win !== null ? win.SpeechRecognition : undefined)
    ?? (win !== undefined && win !== null ? win.webkitSpeechRecognition : undefined)
    ?? null;
}

/** API micro (getUserMedia) disponible, ou null hors navigateur. */
function getMediaDevices(): MediaDevices | null {
  if (typeof navigator === "undefined") return null;
  const n = navigator as Navigator & { mediaDevices?: MediaDevices };
  return n.mediaDevices ?? null;
}

function hasMediaRecorder(): boolean {
  return typeof MediaRecorder !== "undefined";
}

/** Détecte le navigateur courant pour un message d'aide précis. */
function browserFamily(): "chrome" | "safari" | "firefox" | "edge" | "other" {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Edg\//.test(ua)) return "edge";
  if (/Chrome\//.test(ua) && !/CriOS\//.test(ua)) return "chrome";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Safari\//.test(ua) || /CriOS\//.test(ua)) return "safari";
  return "other";
}

/** Message actionnable quand aucune saisie vocale n'est possible. */
export function describeUnsupported(): string {
  const family = browserFamily();
  if (family === "firefox") {
    return "Saisie vocale non supportée dans Firefox — utilisez Chrome/Edge (dictée Gemini) ou la dictée Windows (Win+H) puis collez.";
  }
  if (family === "chrome" || family === "edge") {
    return "Saisie vocale non supportée — vérifiez la permission micro (icône 🔒 à gauche de l'URL), puis réessayez.";
  }
  if (family === "safari") {
    return "Activez la dictée dans Réglages Safari > Confidentialité > Reconnaissance vocale, puis réessayez.";
  }
  return "Saisie vocale non supportée par ce navigateur. Utilisez Chrome ou Edge, ou activez la permission micro (🔒 à gauche de l'URL).";
}

/** Message précis selon l'erreur d'autorisation micro. */
function permissionErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : null;
  const message = error instanceof Error ? error.message : String(error);
  if (name === "NotAllowedError" || message.toLowerCase().includes("permission")) {
    return "Accès au micro refusé par le navigateur. Autorisez-le (icône 🔒 à gauche de l'URL) puis réessayez.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Aucun micro détecté sur cet appareil.";
  }
  if (name === "NotReadableError") {
    return "Micro déjà utilisé par une autre application — fermez-la puis réessayez.";
  }
  return `Démarrage du micro impossible : ${message}`;
}

/**
 * SpeechService — quatre états publics (idle/listening/processing/unsupported),
 * deux providers :
 *   1. GEMINI (préféré) : enregistrement MediaRecorder → POST /voice/transcribe ;
 *   2. Web Speech API (repli) si le premier est indisponible.
 */
export class SpeechService {
  private readonly language: "fr" | "en";
  private events: SpeechEvents = {};
  private state: SpeechState = "idle";
  private cancelRequested = false;

  /* Repli Web Speech API */
  private recognition: RecognitionLike | null = null;
  private finalText = "";

  /* Provider Gemini : enregistrement micro. */
  private stream: MediaStream | null = null;
  private mediaRecorder: (MediaRecorder & { abort?: () => void }) | null = null;
  private recordedChunks: Blob[] = [];

  constructor(language: "fr" | "en" = "fr") {
    this.language = language;
  }

  isSupported(): boolean {
    return (
      (getMediaDevices() !== null && hasMediaRecorder()) ||
      getRecognitionCtor() !== null
    );
  }

  getState(): SpeechState {
    return this.state;
  }

  private setState(state: SpeechState): void {
    this.state = state;
    this.events.onStateChange?.(state);
  }

  start(events: SpeechEvents = {}): void {
    if (this.state === "listening" || this.state === "processing") return;
    this.events = events;
    this.finalText = "";
    this.recordedChunks = [];
    this.cancelRequested = false;

    const media = getMediaDevices();
    if (media !== null && hasMediaRecorder()) {
      this.promptMicrophone(media);
      return;
    }
    if (getRecognitionCtor() !== null) {
      this.startRecognition();
      return;
    }
    this.setState("unsupported");
    this.events.onError?.(describeUnsupported());
  }

  /* ------------------------ Enregistrement micro → Gemini ----------------------- */

  private promptMicrophone(media: MediaDevices): void {
    media
      .getUserMedia({ audio: true })
      .then((stream: MediaStream) => {
        if (this.cancelRequested) {
          this.stopTracks(stream);
          this.setState("idle");
          return;
        }
        this.stream = stream;
        const mimeType = this.pickMediaType();
        let recorder: MediaRecorder;
        try {
          recorder =
            mimeType !== undefined
              ? new MediaRecorder(stream, { mimeType })
              : new MediaRecorder(stream);
        } catch {
          this.stopTracks(stream);
          this.stream = null;
          this.fallbackToRecognition();
          return;
        }
        this.mediaRecorder = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) this.recordedChunks.push(event.data);
        };
        recorder.onstop = () => {
          void this.finishRecording();
        };
        recorder.onerror = () => {
          this.releaseStream();
          this.setState("idle");
          this.events.onError?.("Erreur d'enregistrement du micro.");
        };
        recorder.start(250);
        this.setState("listening");
      })
      .catch((error: unknown) => {
        this.setState("unsupported");
        this.events.onError?.(permissionErrorMessage(error));
      });
  }

  private pickMediaType(): string | undefined {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    if (typeof MediaRecorder === "undefined") return undefined;
    for (const type of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(type)) return type;
      } catch {
        /* noop — on essaie le suivant */
      }
    }
    return undefined;
  }

  private async finishRecording(): Promise<void> {
    this.releaseStream();
    if (this.cancelRequested) {
      this.cancelRequested = false;
      this.setState("idle");
      return;
    }
    if (this.recordedChunks.length === 0) {
      this.setState("idle");
      this.events.onError?.("Aucune parole enregistrée — réessayez.");
      return;
    }
    const type = this.mediaRecorder?.mimeType || "audio/webm";
    const blob = new Blob(this.recordedChunks, { type });
    this.recordedChunks = [];
    this.mediaRecorder = null;
    this.setState("processing");
    try {
      const text = await transcribeAudio(blob, this.language);
      this.setState("idle");
      const trimmed = text.trim();
      if (trimmed.length > 0) this.events.onTranscript?.(trimmed);
      else this.events.onError?.("Transcription vide — réessayez.");
    } catch (error) {
      this.setState("idle");
      /* Repli : si le serveur Gemini est injoignable, on tente la reconnaissance
         navigateur native lorsqu'elle existe (même micro déjà autorisé). */
      if (getRecognitionCtor() !== null) {
        this.startRecognition();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.events.onError?.(
        `Transcription Gemini impossible (${message.slice(0, 160)}). Vérifiez que le serveur local est lancé puis réessayez.`,
      );
    }
  }

  private releaseStream(): void {
    if (this.stream !== null) this.stopTracks(this.stream);
    this.stream = null;
  }

  private stopTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) track.stop();
  }

  private fallbackToRecognition(): void {
    if (getRecognitionCtor() !== null) {
      this.startRecognition();
      return;
    }
    this.setState("unsupported");
    this.events.onError?.(describeUnsupported());
  }

  /* --------------------------- Repli Web Speech API --------------------------- */

  private startRecognition(): void {
    const Ctor = getRecognitionCtor();
    if (Ctor === null) {
      this.setState("unsupported");
      this.events.onError?.(describeUnsupported());
      return;
    }
    this.recognition = new Ctor();
    this.recognition.lang = this.language === "en" ? "en-US" : "fr-FR";
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.onresult = (event) => {
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const alternative = result[0];
        if (alternative === undefined) continue;
        const text = alternative.transcript.trim();
        if (text.length > 0 && text !== this.finalText) {
          this.finalText = text;
          this.events.onTranscript?.(text);
        }
      }
    };
    this.recognition.onerror = (event) => {
      this.setState("idle");
      const code = event.error;
      let message = "Erreur de reconnaissance vocale.";
      if (code === "not-allowed" || code === "service-not-allowed") {
        message =
          "Accès au micro refusé par le navigateur. Autorisez-le (icône 🔒 dans la barre d'adresse) puis réessayez.";
      } else if (code === "no-speech") {
        message = "Aucune parole détectée — réessayez en parlant près du micro.";
      } else if (code === "audio-capture") {
        message = "Aucun micro détecté sur cet appareil.";
      } else if (code === "network") {
        message =
          "Service de reconnaissance vocale injoignable (réseau bloqué ou service indisponible). Vérifiez la connexion.";
      }
      this.events.onError?.(message);
    };
    this.recognition.onend = () => {
      if (this.state === "listening") this.setState("idle");
    };
    try {
      this.recognition.start();
      this.setState("listening");
    } catch (exc: unknown) {
      this.setState("idle");
      this.events.onError?.(exc instanceof Error ? exc.message : "Démarrage du micro impossible.");
    }
  }

  /* ------------------------------ API publique ------------------------------- */

  /** Arrête l'écoute et livre la transcription finale via onTranscript. */
  stop(): void {
    if (this.state === "processing") return;
    if (this.mediaRecorder !== null && this.state === "listening") {
      this.setState("processing");
      try {
        this.mediaRecorder.stop();
      } catch {
        void this.finishRecording();
      }
      return;
    }
    if (this.recognition !== null && this.state === "listening") {
      this.recognition.stop();
      this.setState("processing");
      if (this.finalText.length > 0) this.events.onTranscript?.(this.finalText);
    }
  }

  cancel(): void {
    this.cancelRequested = true;
    this.mediaRecorder?.abort?.();
    this.mediaRecorder = null;
    this.releaseStream();
    this.recognition?.abort();
    this.recognition = null;
    this.finalText = "";
    this.setState("idle");
  }
}

/** Instance partagée du service de saisie vocale. */
export const reportSpeechService = new SpeechService("fr");