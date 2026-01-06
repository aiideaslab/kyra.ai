// AssemblyAI Service for Speaker Diarization
// Uses Vercel serverless functions as proxy to bypass CORS

const ASSEMBLY_REALTIME_URL = 'wss://api.assemblyai.com/v2/realtime/ws';

export interface DiarizedUtterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface DiarizedTranscript {
  text: string;
  utterances: DiarizedUtterance[];
  speakers: string[];
  status: 'completed' | 'error';
  error?: string;
}

// Real-time transcription session
export interface RealtimeSession {
  socket: WebSocket;
  stop: () => void;
}

// Get temporary token for real-time streaming (via proxy)
async function getRealtimeToken(): Promise<string> {
  const response = await fetch('/api/assembly-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get realtime token');
  }

  const data = await response.json();
  return data.token;
}

// Start real-time transcription with microphone
export async function startRealtimeTranscription(
  onTranscript: (text: string, isFinal: boolean) => void,
  onError: (error: string) => void
): Promise<RealtimeSession> {
  try {
    // Get temporary token via proxy
    const token = await getRealtimeToken();
    
    // Connect WebSocket (this goes direct to AssemblyAI - WebSocket doesn't have CORS)
    const socket = new WebSocket(`${ASSEMBLY_REALTIME_URL}?sample_rate=16000&token=${token}`);
    
    let audioContext: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let stream: MediaStream | null = null;

    socket.onopen = async () => {
      try {
        // Get microphone access
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          } 
        });

        // Create audio context for raw PCM
        audioContext = new AudioContext({ sampleRate: 16000 });
        source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
          if (socket.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            // Convert Float32 to Int16
            const int16Data = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
            }
            // Send as base64
            const uint8 = new Uint8Array(int16Data.buffer);
            let binary = '';
            for (let i = 0; i < uint8.length; i++) {
              binary += String.fromCharCode(uint8[i]);
            }
            const base64 = btoa(binary);
            socket.send(JSON.stringify({ audio_data: base64 }));
          }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
      } catch (err: any) {
        onError(`Microphone access failed: ${err.message}`);
      }
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.message_type === 'FinalTranscript' && data.text) {
        onTranscript(data.text, true);
      } else if (data.message_type === 'PartialTranscript' && data.text) {
        onTranscript(data.text, false);
      }
    };

    socket.onerror = () => {
      onError('WebSocket connection error');
    };

    socket.onclose = (event) => {
      if (event.code !== 1000) {
        onError(`Connection closed: ${event.reason || 'Unknown reason'}`);
      }
    };

    // Return session with stop function
    return {
      socket,
      stop: () => {
        // Send termination message
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ terminate_session: true }));
        }
        socket.close();
        
        // Cleanup audio
        if (processor) processor.disconnect();
        if (source) source.disconnect();
        if (audioContext) audioContext.close();
        if (stream) stream.getTracks().forEach(track => track.stop());
      }
    };
  } catch (error: any) {
    onError(error.message);
    throw error;
  }
}

// Upload audio file via proxy
async function uploadAudio(audioBlob: Blob): Promise<string> {
  const response = await fetch('/api/assembly-upload', {
    method: 'POST',
    body: audioBlob,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Upload failed');
  }

  const data = await response.json();
  return data.upload_url;
}

// Start transcription with speaker diarization via proxy
async function startTranscription(audioUrl: string): Promise<string> {
  const response = await fetch('/api/assembly-transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_url: audioUrl }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Transcription start failed');
  }

  const data = await response.json();
  return data.id;
}

// Poll for transcription result via proxy
async function pollTranscription(transcriptId: string): Promise<any> {
  while (true) {
    const response = await fetch(`/api/assembly-status?id=${transcriptId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Polling failed');
    }

    const data = await response.json();

    if (data.status === 'completed') {
      return data;
    } else if (data.status === 'error') {
      throw new Error(`Transcription failed: ${data.error}`);
    }

    // Wait 3 seconds before polling again
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

// Main function: Transcribe with speaker diarization
export async function transcribeWithDiarization(
  audioFile: File | Blob,
  onProgress?: (status: string) => void
): Promise<DiarizedTranscript> {
  try {
    // Step 1: Upload audio
    onProgress?.('Uploading audio...');
    const uploadUrl = await uploadAudio(audioFile);

    // Step 2: Start transcription with diarization
    onProgress?.('Starting speaker detection...');
    const transcriptId = await startTranscription(uploadUrl);

    // Step 3: Poll for results
    onProgress?.('Processing audio (this may take a moment)...');
    const result = await pollTranscription(transcriptId);

    // Step 4: Format results
    const utterances: DiarizedUtterance[] = (result.utterances || []).map((u: any) => ({
      speaker: u.speaker,
      text: u.text,
      start: u.start,
      end: u.end,
      confidence: u.confidence,
    }));

    // Get unique speakers
    const speakers = [...new Set(utterances.map(u => u.speaker))].sort();

    return {
      text: result.text,
      utterances,
      speakers,
      status: 'completed',
    };
  } catch (error: any) {
    return {
      text: '',
      utterances: [],
      speakers: [],
      status: 'error',
      error: error.message,
    };
  }
}

// Format diarized transcript for display
export function formatDiarizedTranscript(result: DiarizedTranscript): string {
  if (result.status === 'error') {
    return `Error: ${result.error}`;
  }

  if (result.utterances.length === 0) {
    return result.text;
  }

  // Format as "Speaker A: text\nSpeaker B: text\n..."
  return result.utterances
    .map(u => `Speaker ${u.speaker}: ${u.text}`)
    .join('\n\n');
}

// Check if AssemblyAI is available (proxy configured)
export async function checkAssemblyAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/api/assembly-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}
