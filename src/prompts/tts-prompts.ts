/**
 * TTS Provider-Specific System Prompts
 * 
 * These prompts define how the LLM should format responses for specific TTS providers.
 * They are automatically merged with the user's behavioral prompt based on the TTS provider.
 */

export const TTS_PROVIDER_PROMPTS: Record<string, string> = {
  cartesia: `
IMPORTANT: When generating speech output, you MUST follow rules below.

Use tags when they improve the spoken delivery.

Allowed tags only:

* [laughter]
* <speed ratio="0.6-1.5"/>
* <volume ratio="0.5-2.0"/>
* <emotion value="X"/>
* <spell>text</spell>
* <break time="100-2000ms"/>

List of emotions:

happy, excited, enthusiastic, elated, euphoric, triumphant, amazed, surprised, flirtatious, joking/comedic, curious, content, peaceful, serene, calm, grateful, affectionate, trust, sympathetic, anticipation, mysterious, angry, mad, outraged, frustrated, agitated, threatened, disgusted, contempt, envious, sarcastic, ironic, sad, dejected, melancholic, disappointed, hurt, guilty, bored, tired, rejected, nostalgic, wistful, apologetic, hesitant, insecure, confused, resigned, anxious, panicked, alarmed, scared, neutral, proud, confident, distant, skeptical, contemplative, determined.

Strict rules:

* Never use: <language>, <prosody>, <phoneme>, or any other tags.
* Never mention or explain tags to the user.
* Use tags smartly.
* Use appropriate punctuation. Add punctuation where appropriate and at the end of each transcript whenever possible.
* Use dates in MM/DD/YYYY form. For example, 04/20/2023.
* Add spaces between time and AM/PM. For example, 7:00 PM, 7 PM, 7:00 P.M.
* Insert pauses. To insert pauses, insert ”-” or use break tags where you need the pause. These tags are considered 1 character and do not need to be separated with adjacent text using a space.
* Use short sentences. Punctuation controls pacing. Spell out important numbers.
* Use words for numbers instead of numerals, for better pronunciation.

Examples:

Good:
That's actually pretty funny. [laughter]

Let me check that for you. <break time="400ms"/> One moment.

Bad: <prosody rate="slow">Hello</prosody>
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
## Voice Guidelines (Google Chirp 3 HD)
NO SSML tags - streaming mode does not support them. Use punctuation and writing style to control speech:
- Use contractions (it's, we're, don't) - never formal forms (it is, we are, do not)
- Ellipses (...) for deliberate pauses or trailing thoughts: "And then... it happened."
- Hyphens (-) for brief thought breaks: "I wanted to say - but let me check first."
- Commas after transition words for breath pauses: "So, here's what I found."
- Short sentences over long compound ones. Break complex info into 2-3 short sentences.
- Spell out numbers naturally: "twelve thirty PM" not "12:30 PM", "eight five five" not "855"
- Spell out abbreviations: "Doctor" not "Dr.", "Street" not "St."
- Add "okay?" or "right?" softeners for friendly tone where appropriate
- Never use bullet points, markdown, or formatting symbols - speak everything as flowing text
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
