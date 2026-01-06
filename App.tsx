import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, Upload, Sparkles, Send, Copy, Download, X, FileText, 
  ArrowRight, Loader2, ClipboardList, Settings2, Zap, User,
  Settings, History, FileUp, Home, Moon, Sun, Users, Link2, RotateCcw
} from 'lucide-react';
import { InputMode, OutputFormat, SummaryLength } from './types';
import { transformContentStream, transcribeAudioFile } from './services/geminiService';

// ============================================
// TYPES & CONSTANTS
// ============================================

type Tool = 'voice' | 'upload' | 'video' | 'meeting' | null;
type Theme = 'gold' | 'violet';
type Tone = 'professional' | 'casual' | 'friendly';

const TOOLS = [
  { 
    id: 'voice' as Tool, 
    icon: Mic, 
    label: 'Voice Note', 
    description: 'Record and transform instantly',
    color: 'text-yellow-400',
  },
  { 
    id: 'upload' as Tool, 
    icon: FileUp, 
    label: 'Upload Audio', 
    description: 'Transcribe audio files',
    color: 'text-emerald-400',
  },
  { 
    id: 'video' as Tool, 
    icon: Link2, 
    label: 'Video URL', 
    description: 'YouTube, Vimeo & more',
    color: 'text-red-400',
  },
  { 
    id: 'meeting' as Tool, 
    icon: Users, 
    label: 'Meeting Notes', 
    description: 'Speaker diarization',
    color: 'text-blue-400',
  },
];

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇸🇬' },
  { code: 'zh', name: '中文', flag: '🇸🇬' },
  { code: 'ms', name: 'Melayu', flag: '🇸🇬' },
  { code: 'ta', name: 'தமிழ்', flag: '🇸🇬' },
];

// ============================================
// MAIN APP COMPONENT
// ============================================

const App: React.FC = () => {
  // Theme
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('kyra_theme') as Theme) || 'gold';
    }
    return 'gold';
  });

  // Navigation
  const [activeTool, setActiveTool] = useState<Tool>(null);
  
  // Animation state
  const [mounted, setMounted] = useState(false);

  // Input state
  const [inputMode, setInputMode] = useState<InputMode>(InputMode.RECORD);
  const [transcript, setTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  // Output state
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(OutputFormat.EMAIL);
  const [summaryLength, setSummaryLength] = useState<SummaryLength>(SummaryLength.MEDIUM);
  const [tone, setTone] = useState<Tone>('professional');
  const [language, setLanguage] = useState('en');
  const [transformedOutput, setTransformedOutput] = useState('');
  const [isTransforming, setIsTransforming] = useState(false);

  // UI state
  const [error, setError] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [styleGuide, setStyleGuide] = useState('');
  const [styleInput, setStyleInput] = useState('');
  const [history, setHistory] = useState<any[]>([]);

  // Refs
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ============================================
  // EFFECTS
  // ============================================

  // Trigger mount animation
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Apply theme
  useEffect(() => {
    document.body.className = `theme-${theme}`;
    localStorage.setItem('kyra_theme', theme);
  }, [theme]);

  // Recording timer
  useEffect(() => {
    let timer: number;
    if (isRecording) {
      timer = window.setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } else {
      setRecordingTime(0);
    }
    return () => clearInterval(timer);
  }, [isRecording]);

  // Keyboard shortcut (Cmd/Ctrl + Enter to transform)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && transcript && !isTransforming) {
        handleTransform();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [transcript, isTransforming]);

  // Auto-transform when format/settings change (only if transcript exists and we already have output)
  const prevFormatRef = useRef(outputFormat);
  const prevToneRef = useRef(tone);
  const prevLengthRef = useRef(summaryLength);
  const prevLanguageRef = useRef(language);
  
  useEffect(() => {
    const settingsChanged = 
      prevFormatRef.current !== outputFormat ||
      prevToneRef.current !== tone ||
      prevLengthRef.current !== summaryLength ||
      prevLanguageRef.current !== language;
    
    if (settingsChanged && transcript && transformedOutput && !isTransforming) {
      handleTransform();
    }
    
    prevFormatRef.current = outputFormat;
    prevToneRef.current = tone;
    prevLengthRef.current = summaryLength;
    prevLanguageRef.current = language;
  }, [outputFormat, tone, summaryLength, language]);

  // ============================================
  // HANDLERS
  // ============================================

  const toggleTheme = () => setTheme(prev => prev === 'gold' ? 'violet' : 'gold');

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      setIsRecording(true);
      setError('');
      
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setError('Speech recognition not supported. Try Chrome.');
        setIsRecording(false);
        return;
      }

      await navigator.mediaDevices.getUserMedia({ audio: true });

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      let finalTranscript = transcript;

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + ' ';
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        setTranscript(finalTranscript + interimTranscript);
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          setError(`Recognition error: ${event.error}`);
        }
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      setError(err.message || 'Microphone access denied.');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  const handleTransform = async () => {
    if (!transcript) return;
    setIsTransforming(true);
    setTransformedOutput('');
    setError('');

    try {
      const apiKey = 'AIzaSyCsnI8KF9Mw1sRUVPUNPbIPHNNQwI19S7c';
      const stream = transformContentStream(transcript, outputFormat, { summaryLength, tone, language, styleGuide }, apiKey);
      for await (const chunk of stream) {
        setTransformedOutput(prev => prev + String(chunk));
      }
    } catch (err: any) {
      setError('Failed to transform content.');
    } finally {
      setIsTransforming(false);
    }
  };

  const handleClear = () => {
    setTranscript('');
    setTransformedOutput('');
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(transformedOutput);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const downloadOutput = () => {
    const blob = new Blob([transformedOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kyra-${outputFormat.toLowerCase()}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRetransform = () => {
    if (transcript) {
      handleTransform();
    }
  };

  const SAMPLE_TEXT = "Hey team, just wanted to follow up on yesterday's meeting. We discussed the new product launch timeline and agreed to push it to March 15th. Sarah will handle the marketing materials, John's taking care of the website updates, and I'll coordinate with the vendors. Let's sync again next Tuesday to review progress. Also, don't forget we need to finalize the budget by end of this week.";

  const handleTrySample = () => {
    setTranscript(SAMPLE_TEXT);
  };

  const saveStyleGuide = () => {
    setStyleGuide(styleInput);
    setShowStyleModal(false);
    localStorage.setItem('kyra_style_guide', styleInput);
  };

  // ============================================
  // HUB PAGE (when no tool selected)
  // ============================================

  if (!activeTool) {
    return (
      <div className="min-h-screen flex flex-col p-6 max-w-5xl mx-auto">
        {/* Header */}
        <header className="flex justify-between items-center py-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 accent-gradient rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">KYRA</h1>
              <p className="text-[10px] text-neutral-500 tracking-widest uppercase">Speak it. Shape it.</p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className="w-10 h-10 rounded-full glass-card flex items-center justify-center hover:scale-105 transition-all"
          >
            {theme === 'gold' ? <Moon className="w-4 h-4 text-yellow-400" /> : <Sun className="w-4 h-4 text-violet-400" />}
          </button>
        </header>

        {/* Hero */}
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-semibold mb-5 tracking-tight">
              What would you like to{' '}
              <span className={`bg-clip-text text-transparent ${theme === 'gold' ? 'bg-gradient-to-r from-yellow-400 via-yellow-300 to-yellow-500' : 'bg-gradient-to-r from-violet-400 via-purple-400 to-violet-500'}`}>
                transform
              </span>?
            </h2>
            <p className="text-base text-neutral-500">
              Choose a tool to get started.
            </p>
          </div>

          {/* Tool Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 w-full max-w-3xl">
            {TOOLS.map((tool, index) => {
              const Icon = tool.icon;
              const isComingSoon = tool.id !== 'voice';
              return (
                <button
                  key={tool.id}
                  onClick={() => {
                    if (isComingSoon) return;
                    setActiveTool(tool.id);
                    if (tool.id === 'meeting') {
                      setOutputFormat(OutputFormat.MEETING);
                      setInputMode(InputMode.RECORD);
                    } else if (tool.id === 'upload') {
                      setInputMode(InputMode.UPLOAD);
                    } else if (tool.id === 'voice') {
                      setInputMode(InputMode.RECORD);
                    }
                  }}
                  className={`group relative rounded-2xl p-6 text-center bg-white/[0.02] border border-white/[0.04] ${isComingSoon ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-white/[0.06] hover:border-white/[0.1] hover:scale-[1.02] hover:-translate-y-0.5 active:scale-[0.98]'}`}
                  style={{ 
                    opacity: mounted ? (isComingSoon ? 0.6 : 1) : 0,
                    transform: mounted ? 'translateY(0)' : 'translateY(40px)',
                    transition: `opacity 0.7s ease-out ${0.3 + index * 0.15}s, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${0.3 + index * 0.15}s`
                  }}
                >
                  {isComingSoon && (
                    <span className="absolute top-2 right-2 text-[9px] px-2 py-0.5 rounded-full bg-white/10 text-neutral-400 font-medium">
                      SOON
                    </span>
                  )}
                  <Icon className={`w-6 h-6 ${tool.color} mx-auto mb-4 transition-all duration-300 ${!isComingSoon && 'group-hover:scale-110'}`} />
                  <h3 className="text-sm font-semibold mb-1.5 text-white">{tool.label}</h3>
                  <p className="text-xs text-neutral-400">{tool.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center py-6">
          <p className="text-[11px] text-neutral-600 tracking-wide">
            A product of <span className="text-neutral-400 font-medium">AIXRDev Labs</span>
          </p>
        </footer>

        {/* Style Modal */}
        {showStyleModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowStyleModal(false)}>
            <div className="glass-card rounded-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <h2 className="font-bold">Voice Profile</h2>
                <button onClick={() => setShowStyleModal(false)}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4">
                <textarea
                  value={styleInput}
                  onChange={e => setStyleInput(e.target.value)}
                  className="w-full h-48 bg-black/50 border border-white/10 rounded-xl p-4 text-sm resize-none focus:outline-none"
                  placeholder="Describe your writing style..."
                />
              </div>
              <div className="flex justify-end p-4 border-t border-white/5">
                <button onClick={saveStyleGuide} className="px-6 py-2 accent-gradient rounded-lg text-sm font-bold text-black">
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================
  // TOOL PAGE (when tool is selected)
  // ============================================

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex justify-between items-center py-3">
        <button
          onClick={() => setActiveTool(null)}
          className="flex items-center space-x-3 hover:opacity-80 transition-opacity"
        >
          <div className="w-10 h-10 rounded-full glass-card flex items-center justify-center">
            <Home className="w-4 h-4 accent-text" />
          </div>
          <div className="w-10 h-10 accent-gradient rounded-xl flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <h1 className="text-xl font-semibold tracking-tight">KYRA</h1>
            <p className="text-[10px] text-neutral-500 uppercase tracking-widest">
              {TOOLS.find(t => t.id === activeTool)?.label}
            </p>
          </div>
        </button>
        <button onClick={toggleTheme} className="w-10 h-10 rounded-full glass-card flex items-center justify-center hover:scale-105 transition-all">
          {theme === 'gold' ? <Moon className="w-4 h-4 text-yellow-400" /> : <Sun className="w-4 h-4 text-violet-400" />}
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 py-4">
        {/* Input Panel */}
        <div className="glass-card rounded-2xl p-6 flex flex-col">
          <h3 className="text-sm font-bold mb-4 text-neutral-400 uppercase tracking-wider">Input</h3>
          
          {/* Recording UI */}
          <div className="flex-1 flex flex-col items-center justify-center">
            {inputMode === InputMode.RECORD && (
              <div className="text-center">
                <div className="relative">
                  {isRecording && (
                    <div className="absolute inset-0 w-32 h-32 rounded-full bg-red-500/30 animate-ping" />
                  )}
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all ${
                      isRecording ? 'bg-red-500' : 'glass-card hover:scale-105'
                    }`}
                  >
                    {isRecording ? (
                      <div className="w-8 h-8 bg-white rounded" />
                    ) : (
                      <Mic className="w-10 h-10 accent-text" />
                    )}
                  </button>
                </div>
                <p className="mt-4 text-sm text-neutral-400">
                  {isRecording ? formatTime(recordingTime) : 'Tap to record'}
                </p>
              </div>
            )}

            {/* Transcript - Always visible */}
            <div className="w-full mt-6">
              <textarea
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                className="w-full h-32 bg-black/30 border border-white/10 rounded-xl p-4 text-sm resize-none focus:outline-none focus:border-white/20"
                placeholder="Or type/paste your content here..."
              />
              {transcript && (
                <div className="flex justify-end mt-2">
                  <span className="text-[10px] px-2 py-1 rounded-md bg-white/5 text-neutral-400 font-medium">
                    {transcript.split(/\s+/).filter(Boolean).length} WORDS
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-4">
            <button onClick={handleClear} className="px-4 py-2 glass-card rounded-lg text-sm">
              Clear
            </button>
            <button
              onClick={handleTransform}
              disabled={!transcript || isTransforming}
              className="flex-1 py-3 accent-gradient rounded-xl text-black font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isTransforming ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Transform
                  <span className="text-[10px] opacity-60 ml-1">⌘↵</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Output Panel */}
        <div className="glass-card rounded-2xl p-6 flex flex-col min-h-[500px]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">Output</h3>
            {transformedOutput && (
              <button onClick={handleRetransform} className="text-sm accent-text flex items-center gap-1 hover:opacity-80">
                <Sparkles className="w-4 h-4" /> Re-transform
              </button>
            )}
          </div>

          {/* Format Tabs + Language */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {[OutputFormat.EMAIL, OutputFormat.SUMMARY, OutputFormat.ACTION_ITEMS, OutputFormat.SOCIAL].map(format => (
              <button
                key={format}
                onClick={() => setOutputFormat(format)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  outputFormat === format ? 'accent-gradient text-black' : 'glass-card'
                }`}
              >
                {format === OutputFormat.ACTION_ITEMS ? 'ACTIONS' : format}
              </button>
            ))}
            <div className="ml-auto">
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                className="bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-white/30 cursor-pointer"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Settings Row */}
          <div className="flex flex-wrap items-center gap-4 mb-4 text-xs">
            {/* Length */}
            <div className="flex items-center gap-2">
              <span className="text-neutral-500">LENGTH</span>
              {['SHORT', 'MEDIUM', 'LONG'].map(len => (
                <button
                  key={len}
                  onClick={() => setSummaryLength(len as SummaryLength)}
                  className={`px-2 py-1 rounded-md transition-all ${
                    summaryLength === len ? 'accent-gradient text-black font-medium' : 'glass-card hover:bg-white/10'
                  }`}
                >
                  {len.charAt(0) + len.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            
            {/* Tone */}
            <div className="flex items-center gap-2">
              <span className="text-neutral-500">TONE</span>
              {[
                { key: 'professional', label: '💼 Pro', short: 'Pro' },
                { key: 'casual', label: '😎 Casual', short: 'Casual' },
                { key: 'friendly', label: '😊 Friendly', short: 'Friendly' }
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTone(t.key as Tone)}
                  className={`px-2 py-1 rounded-md transition-all ${
                    tone === t.key ? 'accent-gradient text-black font-medium' : 'glass-card hover:bg-white/10'
                  }`}
                >
                  {t.short}
                </button>
              ))}
            </div>
          </div>

          {/* Output Content */}
          <div className="flex-1 bg-black/30 border border-white/10 rounded-xl p-4 overflow-y-auto min-h-[250px] max-h-[350px]">
            {isTransforming ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin accent-text" />
              </div>
            ) : transformedOutput ? (
              <pre className="text-sm whitespace-pre-wrap">{transformedOutput}</pre>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-12 h-12 accent-gradient rounded-full flex items-center justify-center mb-4 opacity-60">
                  <Sparkles className="w-6 h-6 text-black" />
                </div>
                <p className="text-neutral-300 font-medium mb-1">Ready to transform</p>
                <p className="text-neutral-500 text-sm mb-4">Record, upload, or paste your content on the left panel</p>
                <button
                  onClick={handleTrySample}
                  className="flex items-center gap-2 px-4 py-2 accent-gradient rounded-lg text-black text-sm font-medium hover:opacity-90 transition-all"
                >
                  <Zap className="w-4 h-4" /> Try with sample text
                </button>
              </div>
            )}
          </div>

          {error && (
            <p className="text-red-400 text-sm mt-2">{error}</p>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
            <button
              onClick={handleClear}
              className="px-3 py-1.5 glass-card rounded-lg text-xs font-medium flex items-center gap-1 text-neutral-400 hover:text-white hover:bg-white/10 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Start Over
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={copyToClipboard}
                disabled={!transformedOutput}
                className="px-3 py-1.5 glass-card rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-30 hover:bg-white/10 transition-all"
              >
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
              <button
                onClick={downloadOutput}
                disabled={!transformedOutput}
                className="px-3 py-1.5 glass-card rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-30 hover:bg-white/10 transition-all"
              >
                <Download className="w-3.5 h-3.5" /> TXT
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-4">
        <p className="text-[11px] text-neutral-600 tracking-wide">
          Powered by <span className="text-neutral-400 font-medium">AIXRDev Labs</span>
        </p>
      </footer>

      {/* Copy Success Toast */}
      {copySuccess && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-green-500/90 text-white text-sm font-medium rounded-lg shadow-lg animate-fade-in-up z-50">
          ✓ Copied to clipboard
        </div>
      )}
    </div>
  );
};

export default App;
