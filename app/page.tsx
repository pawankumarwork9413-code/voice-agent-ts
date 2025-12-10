"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

// Declare SpeechRecognition types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export default function Home() {
  const [username, setUsername] = useState("");
  const [chatId, setChatId] = useState("");
  const [topic, setTopic] = useState("");
  const topicRef = useRef(""); // Track topic for closures
  const [story, setStory] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const isSpeakingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const autoSendTriggeredRef = useRef(false);
  const silenceTimerRef = useRef<number | null>(null);
  const listeningPausedForTtsRef = useRef(false);
  const userStoppedRef = useRef(false); // Track manual stop
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null); // Fix GC issue

  const SILENCE_DURATION = 1000; // 1.5 seconds silence triggers auto-send

  const generateRandomId = () => Math.random().toString(36).substring(2, 10);

  // Sync topic ref
  useEffect(() => {
    topicRef.current = topic;
  }, [topic]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setChatId(generateRandomId()); // Generate random ID on mount
    setSpeechSupported(
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window
    );
    setTtsSupported("speechSynthesis" in window);
  }, []);

  useEffect(() => {
    if (!speechSupported) return;
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      // Reconstruct full transcript
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setTopic(transcript.trim());
      resetSilenceTimer();
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => {
      setIsListening(false);
      if (listeningPausedForTtsRef.current) return;
      if (autoSendTriggeredRef.current) return;

      // If user didn't stop manually, try to restart or send
      if (!userStoppedRef.current) {
        if (topicRef.current.trim()) {
          triggerAutoSend();
        } else {
          startListening();
        }
      }
    };
    recognitionRef.current = recognition;
    // Removed auto-start on mount to respect "click to open"
    return () => recognition.stop();
  }, [speechSupported]);

  const triggerAutoSend = () => {
    if (autoSendTriggeredRef.current || isLoading) return;
    
    const currentTopic = topicRef.current;
    if (!currentTopic.trim()) return;

    autoSendTriggeredRef.current = true;
    stopListening(); // This is a system stop, not user stop
    
    // Pass currentTopic explicitly to avoid state issues
    runStory(currentTopic).finally(() => {
      autoSendTriggeredRef.current = false;
      // If TTS is not supported, restart listening here. 
      // If TTS IS supported, speakQueue handles restart.
      if (!ttsSupported && !userStoppedRef.current) {
        startListening();
      }
    });
  };

  const resetSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => triggerAutoSend(), SILENCE_DURATION);
  };

  const startListening = () => {
    // Validation removed
    if (!recognitionRef.current || isListening) return;
    autoSendTriggeredRef.current = false;
    try {
      recognitionRef.current.start();
      setIsListening(true);
      // Don't reset silence timer here immediately, wait for input
    } catch {
      // ignore start errors (e.g., already starting)
    }
  };
  const stopListening = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const handleManualStart = () => {
    // Validation removed
    userStoppedRef.current = false;
    startListening();
  };

  const handleManualStop = () => {
    userStoppedRef.current = true;
    stopListening();
    resetSpeech(); // Also stop speaking if user manually stops
  };

  const handleNewChat = () => {
    stopListening();
    resetSpeech();
    setChatId(generateRandomId());
    setStory("");
    setTopic("");
  };

  const pauseListeningForTts = () => {
    // Always set flag to true so we know to resume later, even if already stopped
    listeningPausedForTtsRef.current = true;
    if (isListening) {
      stopListening();
    }
  };
  const resumeListeningAfterTts = () => {
    if (!listeningPausedForTtsRef.current) return;
    listeningPausedForTtsRef.current = false;
    if (speechSupported && recognitionRef.current && !isLoading && !userStoppedRef.current) {
      startListening();
    }
  };

  const speakText = (text: string) => {
    if (!ttsSupported || !text.trim()) return;
    isSpeakingRef.current = true;
    pauseListeningForTts();
    
    const utterance = new SpeechSynthesisUtterance(text);
    currentUtteranceRef.current = utterance; // Prevent GC
    
    utterance.onend = () => {
      currentUtteranceRef.current = null;
      isSpeakingRef.current = false;
      resumeListeningAfterTts();
    };
    utterance.onerror = () => {
      currentUtteranceRef.current = null;
      isSpeakingRef.current = false;
      resumeListeningAfterTts();
    };
    window.speechSynthesis.speak(utterance);
  };

  const resetSpeech = () => {
    if (ttsSupported) {
      window.speechSynthesis.cancel();
      isSpeakingRef.current = false;
      currentUtteranceRef.current = null;
    }
    listeningPausedForTtsRef.current = false;
  };

  const runStory = async (overrideTopic?: string) => {
    if (isLoading) return;
    const textToSend = overrideTopic || topic;
    resetSpeech();
    setIsLoading(true);
    setStory("");
    setTopic(""); // Clear input immediately for better UX
    let fullResponse = "";
    try {
      const res = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: textToSend, username, chatId }),
      });
      if (!res.ok) {
        setStory(`Error: ${await res.text()}`);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setStory(await res.text());
        return;
      }
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });
        setStory((prev) => {
          const updated = prev + chunkText;
          return updated;
        });
        fullResponse += chunkText;
      }
      // Speak complete response at once
      speakText(fullResponse);
    } finally {
      setIsLoading(false);
      autoSendTriggeredRef.current = false;
      // setTopic(""); // Already cleared
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    triggerAutoSend(); // enter key still works for typed input
  };

  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      resetSpeech();
      recognitionRef.current?.stop();
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-100">
      <div className="mx-auto flex h-screen max-w-3xl flex-col gap-4 p-4">
        <header className="flex items-center justify-between rounded-lg border bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <div className="text-sm font-semibold">Voice Chatbot</div>
            {/* <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Speak; 2s pause auto-sends (no tap needed)
            </div> */}
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-24 rounded border px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
              placeholder="jane.doe"
            />
            <button
              onClick={handleNewChat}
              className="rounded bg-zinc-200 px-2 py-1 text-xs hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            >
              New Chat
            </button>
            <div className="text-[10px] text-zinc-400 hidden sm:block">ID: {chatId}</div>
          </div>
        </header>

        <main className="flex-1 overflow-auto rounded-lg border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {story ? (
            <div className="space-y-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Assistant</div>
              <div className="rounded-lg bg-zinc-100 p-3 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 whitespace-pre-wrap">
                {story}
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center text-sm text-zinc-500 dark:text-zinc-400">
              Speak or type a topic to begin.
            </div>
          )}
        </main>

        <form onSubmit={handleSubmit} className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={isListening ? handleManualStop : handleManualStart}
            disabled={!speechSupported || isLoading}
            className={`flex h-16 w-16 items-center justify-center rounded-full border text-2xl font-semibold transition ${
              isListening ? "border-green-500 text-green-600 dark:text-green-400 dark:border-green-500" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={speechSupported ? "Mic status" : "Mic not supported"}
          >
            🎤
          </button>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Speak to auto-send, or type then press Enter..."
            className="flex-1 rounded border px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
          {/* Manual send button removed; speech auto-sends after 2s silence */}
        </form>
      </div>
    </div>
  );
}
