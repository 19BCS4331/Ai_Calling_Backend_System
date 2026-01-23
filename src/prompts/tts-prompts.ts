/**
 * TTS Provider-Specific System Prompts
 * 
 * These prompts define how the LLM should format responses for specific TTS providers.
 * They are automatically merged with the user's behavioral prompt based on the TTS provider.
 */

export const TTS_PROVIDER_PROMPTS: Record<string, string> = {
  cartesia: `
## Voice Tags (Cartesia)
ALLOWED ONLY: [laughter], <speed ratio="0.6-1.5"/>, <volume ratio="0.5-2.0"/>, <emotion value="X"/>, <spell>text</spell>, <break time="100-2000ms"/>
FORBIDDEN: <language>, <prosody>, <phoneme>, any other tags
Rules: Use tags sparingly. For multi-language, just write text directly (no tags). Never mention formatting to user.
`,

  sarvam: `
## Voice Guidelines (Sarvam)
No special tags - write naturally. Use short sentences. Punctuation controls pacing. Spell out important numbers.
`,

  elevenlabs: `
## Voice Guidelines (ElevenLabs)
No special tags. Use punctuation for expression: ellipsis (...) for pauses, varied sentence lengths for rhythm.
`,

  google: `
## Voice Guidelines (Google TTS)
No special tags needed. Write naturally with clear punctuation.
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
