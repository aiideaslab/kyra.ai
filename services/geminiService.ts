
import { GoogleGenAI } from "@google/genai";

// Safe access to API Key to prevent ReferenceError if process is not defined in pure browser
const getApiKey = () => {
  try {
    return process.env.API_KEY;
  } catch (e) {
    return ''; 
  }
};

export const transcribeAudioFile = async (base64Data: string, mimeType: string, apiKey?: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: apiKey || getApiKey() || '' });
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: {
      parts: [
        { inlineData: { mimeType, data: base64Data } },
        { text: "Please provide a highly accurate word-for-word transcript of this audio. No summary, just text." }
      ]
    }
  });
  return response.text || "Transcription failed.";
};

export async function* transformContentStream(
  text: string, 
  format: string, 
  options: { summaryLength?: string; customPrompt?: string; tone?: string; language?: string; styleGuide?: string },
  apiKey?: string
) {
  const ai = new GoogleGenAI({ apiKey: apiKey || getApiKey() || '' });
  
  // Tone instructions
  const toneMap: Record<string, string> = {
    professional: "Use a professional, business-appropriate tone.",
    casual: "Use a casual, relaxed conversational tone.",
    friendly: "Use a warm, friendly, and approachable tone."
  };
  const toneInstruction = toneMap[options.tone || 'professional'] || toneMap.professional;
  
  // Language instructions
  const languageMap: Record<string, string> = {
    en: "Write the output in English.",
    zh: "Write the output in Simplified Chinese (中文).",
    ms: "Write the output in Bahasa Melayu.",
    ta: "Write the output in Tamil (தமிழ்)."
  };
  const languageInstruction = languageMap[options.language || 'en'] || languageMap.en;
  
  // Style guide instruction
  const styleInstruction = options.styleGuide 
    ? `\n\nADDITIONAL STYLE GUIDE - Follow these custom writing style rules:\n${options.styleGuide}\n\n`
    : '';
  
  let systemInstruction = `You are an expert content shaper. ${toneInstruction} ${languageInstruction}${styleInstruction} IMPORTANT: Output plain text only. Never use markdown formatting like **, ##, *, or any other markdown syntax. `;
  
  switch(format) {
    case 'BEAUTIFY':
      systemInstruction += "Clean filler words, fix grammar, keep meaning identical. Output clean plain text.";
      break;
    case 'EMAIL':
      const emailLength = options.summaryLength === 'SHORT' ? "Keep it very brief - 2-3 sentences max. Just the essential message." : options.summaryLength === 'MEDIUM' ? "Keep it concise - one short paragraph." : "Can be more detailed but still professional and to the point.";
      systemInstruction += `Transform this into an email format. Include a subject line at the top. ${emailLength} CRITICAL: Do NOT add information that wasn't in the original. Do NOT make assumptions or elaborate beyond what was said. Only restructure what's given into email format. Plain text only.`;
      break;
    case 'SUMMARY':
      const lengthDesc = options.summaryLength === 'SHORT' ? "max 1-2 sentences" : options.summaryLength === 'MEDIUM' ? "2-3 sentences" : "one paragraph with key points";
      systemInstruction += `Summarize to ${lengthDesc}. Only include what was actually said. Do NOT add assumptions. Plain text only.`;
      break;
    case 'SOCIAL':
      systemInstruction += "Create a social media post for LinkedIn/X. Use plain text with emojis for visual appeal. ONLY use information from the input - do NOT add assumptions or elaborate. Keep it under 280 characters. NO asterisks, NO markdown.";
      break;
    case 'MEETING':
      systemInstruction += `You are an expert meeting transcription analyst specializing in formal meetings, board meetings, and council sessions. Analyze this transcript and create professional meeting notes.

CRITICAL - SPEAKER DETECTION RULES:
1. FIRST, scan the entire transcript to count distinct speakers. Look for:
   - Names mentioned directly ("Hey John", "Thanks Sarah", "Councilman Work")
   - Titles and roles ("Madam Chair", "Council Member", "Secretary")
   - Self-introductions ("I'm Mike from engineering")
   - Different perspectives/opinions on the same topic
   - Question-answer pairs (questioner vs answerer)

2. SPEAKER LABELING:
   - If names are mentioned: Use actual names (e.g., "Councilman Work", "Sarah")
   - If roles are clear: Use role labels (e.g., "Chair", "Council Member", "Secretary")
   - If neither: Use "Speaker A", "Speaker B", "Speaker C" etc.

3. VOTING & MOTIONS DETECTION:
   - Look for motion language: "motion to", "I move that", "second the motion"
   - Track who made motions and who seconded
   - Detect voting: "all in favor", "aye", "nay", "opposed", "abstain"
   - Record roll calls if mentioned
   - Note if motion passed or failed

OUTPUT FORMAT (plain text only, NO markdown, NO asterisks, NO hashtags):

MEETING NOTES
Date: [If mentioned, otherwise omit]
Meeting Type: [Council, Board, Team, etc. if detectable]

PARTICIPANTS:
[List each speaker with name/title and role]
Example:
- Jamie Cosette Sanchez (Chair) - Presided over meeting
- Councilman Work - Made motions
- Council Members (collective) - Voted on items

AGENDA ITEMS DISCUSSED:
[List each topic/item discussed in order]

MOTIONS & VOTES:
[For each motion, record:]
- Motion: [What was proposed]
- Moved by: [Name]
- Seconded by: [Name if mentioned]
- Vote: [Aye/Nay counts or "Voice vote - passed/failed"]
- Result: [Passed/Failed/Tabled]

KEY DECISIONS:
[List all decisions made with outcomes]

ACTION ITEMS:
[Owner] → [Task] → [Deadline if mentioned]

OPEN ITEMS / FOLLOW-UPS:
[Unresolved questions or items for future meetings]

Be thorough with voting records - this is critical for meeting minutes accuracy.`;
      break;
    case 'ACTION_ITEMS':
      systemInstruction += `Extract all action items, tasks, and to-dos from this content. Format as a clear, numbered list. For each item include:
- The task itself
- Who is responsible (if mentioned)
- Deadline or timeframe (if mentioned)

Output as plain text only. Use this format:
1. [Task description] - Owner: [name or "Unassigned"] - Due: [date or "TBD"]

If no clear action items exist, list potential next steps based on the content.`;
      break;
    case 'CUSTOM':
      systemInstruction += (options.customPrompt || "Polish the following text.") + " Output plain text only.";
      break;
  }

  const result = await ai.models.generateContentStream({
    model: 'gemini-2.0-flash',
    contents: { parts: [{ text }] },
    config: { systemInstruction }
  });

  for await (const chunk of result) {
    yield chunk.text || "";
  }
}

export const createPcmBlob = (data: Float32Array) => {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clamp values to prevent distortion
    int16[i] = Math.max(-1, Math.min(1, data[i])) * 32767;
  }
  const uint8 = new Uint8Array(int16.buffer);
  let binary = '';
  // Avoid spread operator on large arrays to prevent stack overflow
  for (let i = 0; i < uint8.byteLength; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return {
    data: btoa(binary),
    mimeType: 'audio/pcm;rate=16000',
  };
};