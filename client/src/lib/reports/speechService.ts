/**
 * SpeechService — abstraction de saisie vocale (INSTRUCTIONS.md §21).
 *
 * Découplage total du provider : le ReportEditor consomme cette interface,
 * jamais Web Speech API directement. Provider réel actuel : Web Speech API
 * lorsqu'elle existe ; sinon état `unsupported` explicite (aucun crash).
 *
 * Pipeline imposé (§18) : microphone → transcription → PREVIEW (Apply /
 * Edit / Cancel) → application. La voix n'écrit jamais directement une
 * donnée médicale sans confirmation.
 */

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
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ------------------------------ Implémentation ------------------------------ */

export class SpeechService {
  private readonly language: "fr" | "en";
  private recognition: RecognitionLike | null = null;
  private events: SpeechEvents = {};
  private state: SpeechState = "idle";
  private finalText = "";

  constructor(language: "fr" | "en" = "fr") {
    this.language = language;
  }

  isSupported(): boolean {
    return getRecognitionCtor() !== null;
  }

  getState(): SpeechState {
    return this.state;
  }

  private setState(state: SpeechState): void {
    this.state = state;
    this.events.onStateChange?.(state);
  }

  /** Démarre l'écoute. no-op si déjà en écoute ou provider absent. */
  start(events: SpeechEvents = {}): void {
    if (this.state === "listening") return;
    this.events = events;
    const Ctor = getRecognitionCtor();
    if (Ctor === null) {
      this.setState("unsupported");
      this.events.onError?.("Saisie vocale non supportée par ce navigateur.");
      return;
    }
    this.finalText = "";
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
          /* Preview : la transcription est proposée, jamais appliquée
             directement par le provider (§18/§19). */
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

  /** Arrête l'écoute et livre la transcription finale via onTranscript. */
  stop(): void {
    if (this.recognition !== null && this.state === "listening") {
      this.recognition.stop();
      this.setState("processing");
      if (this.finalText.length > 0) this.events.onTranscript?.(this.finalText);
    }
  }

  cancel(): void {
    this.recognition?.abort();
    this.recognition = null;
    this.finalText = "";
    this.setState("idle");
  }
}

/** Instance partagée de l'éditeur de rapport. */
export const reportSpeechService = new SpeechService("fr");
