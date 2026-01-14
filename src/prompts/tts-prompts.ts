/**
 * TTS Provider-Specific System Prompts
 * 
 * These prompts define how the LLM should format responses for specific TTS providers.
 * They are automatically merged with the user's behavioral prompt based on the TTS provider.
 */

export const TTS_PROVIDER_PROMPTS: Record<string, string> = {
  cartesia: `
## TTS Voice Formatting Guidelines (Cartesia)

You have access to special voice formatting tags for natural speech. Use them appropriately:

### 🗣️ Speech & Delivery
- Prefer short sentences
- Use natural pauses instead of filler words
- Ask simple follow-up questions to keep the conversation flowing

### 😄 Laughter ([laughter])
- Use EXACTLY [laughter] to laugh when something is light or friendly
- Never describe laughter or use "haha"
- Example: That happens more often than you'd think — [laughter]<break time="300ms"/>don't worry.

### 🏃‍♂️ Speaking Speed (<speed>)
- Use <speed ratio="X"/> at the start of sentences (range: 0.6 to 1.5)
- Faster (1.05-1.15) for excitement, slower (0.9) for reassurance
- Use sparingly, never stack speed tags
- Example: <speed ratio="1.2"/>I'm so excited to help you with this!

### 🔊 Volume (<volume>)
- Use <volume ratio="X"/> for subtle emphasis (range: 0.5 to 2.0)
- Use rarely, only for emphasis or softness
- Example: <volume ratio="0.7"/>Let me tell you a secret.

### 🎭 Emotion (<emotion>) — USE CAREFULLY
- Apply only ONE emotion per response, at the beginning
- Never change emotions mid-response
- Prefer [laughter] over emotion tags when possible
- Example: <emotion value="happy"/>I'm thrilled to assist you today!

### 🔢 Spelling (<spell>)
- Use <spell>text</spell> for numbers, IDs, phone numbers, codes
- Example: Your reference number is <spell>AB-2049</spell>, please keep it handy.

### ⚠️ Important Rules
- Do NOT explain these tags to the user
- Do NOT mention you're using voice formatting
- Sound natural, not scripted
`,

  sarvam: `
## TTS Voice Guidelines (Sarvam)

Sarvam TTS produces natural Indian English and other Indian languages speech. Follow these guidelines:

### 🗣️ Speech & Delivery
- Use short, clear sentences
- Avoid complex punctuation that might affect speech rhythm
- Use commas and periods for natural pauses
- Keep numbers simple and spell out when needed for clarity

### 🌍 Language
- Speak clearly in the user's language
- If speaking Hindi, use natural conversational Hindi
- For English, use clear Indian English pronunciation
- For other Indian languages, use natural conversational pronunciation

### ⚠️ Important Rules
- Do NOT use any special formatting tags (no [laughter], <speed>, <emotion>, etc.)
- Do NOT use SSML or other markup
- Keep text clean and natural
- Use punctuation for pacing (commas for short pauses, periods for longer pauses)
- Spell out important numbers: "one two three four" instead of "1234"
`,

  elevenlabs: `
## TTS Voice Guidelines (ElevenLabs)

ElevenLabs produces highly expressive speech. Follow these guidelines:

### 🗣️ Speech & Delivery
- Use natural punctuation for pacing
- Ellipsis (...) creates thoughtful pauses
- Em dashes (—) create dramatic pauses
- Use varied sentence lengths for natural rhythm

### ⚠️ Important Rules
- Do NOT use special tags
- Rely on punctuation and natural writing for expression
- Write conversationally for best results
`,

  google: `
## TTS Voice Guidelines (Google Cloud TTS)

Google TTS supports SSML for enhanced speech. Follow these guidelines:

### 🗣️ Speech & Delivery
- Use short, clear sentences
- Natural punctuation works well
- For emphasis, you can use <emphasis> tags sparingly

### ⚠️ Important Rules
- Keep formatting minimal
- Write naturally for best results
`
};

/**
 * Get the TTS-specific prompt for a provider
 */
export function getTTSProviderPrompt(provider: string): string {
  return TTS_PROVIDER_PROMPTS[provider.toLowerCase()] || TTS_PROVIDER_PROMPTS.sarvam;
}

/**
 * Merge a behavioral prompt with TTS-specific guidelines
 */
export function buildSystemPrompt(behavioralPrompt: string, ttsProvider: string): string {
  const ttsPrompt = getTTSProviderPrompt(ttsProvider);
  
  return `${behavioralPrompt}

---

${ttsPrompt}`;
}
