/**
 * Default Configuration
 * Example configurations for quick setup
 */

import { STTConfig, LLMConfig, TTSConfig, VoiceConfig, SupportedLanguage } from '../types';

/**
 * Default voice configurations for different languages
 */
export const defaultVoices: Record<SupportedLanguage, VoiceConfig> = {
  'en-IN': {
    voiceId: 'en_female',
    language: 'en-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  },
  'hi-IN': {
    voiceId: 'anushka',
    language: 'hi-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  },
  'ta-IN': {
    voiceId: 'ta_female',
    language: 'ta-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  },
  'te-IN': {
    voiceId: 'te_female',
    language: 'te-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  },
  'ml-IN': {
    voiceId: 'ml_female',
    language: 'ml-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  },
  'kn-IN': {
    voiceId: 'kn_female',
    language: 'kn-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  },
  'bn-IN': {
    voiceId: 'bn_female',
    language: 'bn-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  },
  'mr-IN': {
    voiceId: 'mr_female',
    language: 'mr-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  },
  'gu-IN': {
    voiceId: 'gu_female',
    language: 'gu-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  },
  'pa-IN': {
    voiceId: 'pa_female',
    language: 'pa-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  },
  'unknown': {
    voiceId: 'anushka',
    language: 'hi-IN',
    gender: 'female',
    speakingRate: 1.0,
    pitch: 0
  }
};

/**
 * Create STT config with Sarvam AI
 */
export function createSarvamSTTConfig(
  apiKey: string,
  language: SupportedLanguage = 'hi-IN'
): STTConfig {
  return {
    type: 'sarvam',
    credentials: { apiKey },
    language,
    model: 'saarika:v2.5',
    sampleRateHertz: 16000,
    encoding: 'LINEAR16',
    enablePunctuation: true,
    enableWordTimestamps: false
  };
}

/**
 * Create LLM config with Gemini
 */
export function createGeminiLLMConfig(
  apiKey: string,
  systemPrompt?: string
): LLMConfig {
  return {
    type: 'gemini',
    credentials: { apiKey },
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    maxTokens: 2048,
    topP: 0.95,
    topK: 40,
    systemPrompt: systemPrompt || defaultSystemPrompts.customerService.hindi,
    enableStreaming: true
  };
}

/**
 * Create TTS config with Sarvam AI
 */
export function createSarvamTTSConfig(
  apiKey: string,
  language: SupportedLanguage = 'hi-IN'
): TTSConfig {
  return {
    type: 'sarvam',
    credentials: { apiKey },
    voice: defaultVoices[language] || defaultVoices['hi-IN'],
    audioFormat: {
      encoding: 'MP3',
      sampleRateHertz: 22050,
      channels: 1
    },
    enableSSML: false
  };
}

/**
 * Create TTS config with Reverie
 */
export function createReverieTTSConfig(
  apiKey: string,
  appId: string,
  language: SupportedLanguage = 'hi-IN'
): TTSConfig {
  return {
    type: 'reverie',
    credentials: { 
      apiKey,
      projectId: appId
    },
    voice: defaultVoices[language] || defaultVoices['hi-IN'],
    audioFormat: {
      encoding: 'LINEAR16',
      sampleRateHertz: 22050,
      channels: 1
    },
    enableSSML: false
  };
}

/**
 * Default system prompts for different use cases
 */
export const defaultSystemPrompts = {
  customerService: {
    hindi: `आप एक सहायक AI एजेंट हैं जो ग्राहक सेवा में मदद करते हैं।

आपके मुख्य कार्य:
- ग्राहकों के सवालों का जवाब देना
- उनकी समस्याओं को समझना और समाधान प्रदान करना
- जरूरत पड़ने पर सही विभाग को ट्रांसफर करना

नियम:
- हमेशा विनम्र और सहायक रहें
- स्पष्ट और संक्षिप्त उत्तर दें
- यदि आप कुछ नहीं जानते तो ईमानदारी से बताएं
- ग्राहक की भाषा में जवाब दें`,

    english: `You are a helpful AI customer service agent.

Your main tasks:
- Answer customer questions
- Understand their problems and provide solutions
- Transfer to the right department when needed

Rules:
- Always be polite and helpful
- Give clear and concise answers
- If you don't know something, be honest about it
- Respond in the customer's language`,

    bilingual: `You are a helpful AI customer service agent who speaks both Hindi and English.

आप एक सहायक AI एजेंट हैं जो हिंदी और अंग्रेजी दोनों में बात कर सकते हैं।

Rules / नियम:
- Respond in the same language the customer uses
- जिस भाषा में ग्राहक बोले, उसी में जवाब दें
- Switch languages naturally if the customer does
- Be polite, clear, and helpful
- विनम्र, स्पष्ट और सहायक रहें`
  },

  loanCollection: {
    hindi: `आप एक ऋण संग्रह एजेंट हैं।

आपका उद्देश्य:
- ग्राहक को उनके बकाया भुगतान के बारे में याद दिलाना
- भुगतान योजना पर चर्चा करना
- भुगतान लिंक भेजना

नियम:
- पेशेवर और सम्मानजनक रहें
- ग्राहक की स्थिति को समझें
- धमकी या दबाव न डालें
- वैकल्पिक भुगतान विकल्प प्रदान करें`,

    english: `You are a loan collection agent.

Your purpose:
- Remind customers about their due payments
- Discuss payment plans
- Send payment links

Rules:
- Be professional and respectful
- Understand the customer's situation
- Do not threaten or pressure
- Offer alternative payment options`
  },

  appointmentBooking: {
    hindi: `आप एक अपॉइंटमेंट बुकिंग एजेंट हैं।

आपके कार्य:
- उपलब्ध समय स्लॉट बताना
- अपॉइंटमेंट बुक करना
- अपॉइंटमेंट की पुष्टि करना
- रिमाइंडर भेजना

नियम:
- ग्राहक की सुविधा का ध्यान रखें
- स्पष्ट तारीख और समय बताएं
- पुष्टि विवरण दोहराएं`,

    english: `You are an appointment booking agent.

Your tasks:
- Inform about available time slots
- Book appointments
- Confirm appointments
- Send reminders

Rules:
- Consider customer convenience
- Provide clear date and time
- Repeat confirmation details`
  }
};

/**
 * Example session configuration
 */
export const exampleSessionConfig = {
  tenantId: 'example-tenant',
  language: 'hi-IN' as SupportedLanguage,
  
  // Provider credentials (inject at runtime)
  stt: {
    provider: 'sarvam',
    apiKey: 'YOUR_SARVAM_API_KEY'
  },
  llm: {
    provider: 'gemini',
    apiKey: 'YOUR_GEMINI_API_KEY',
    model: 'gemini-2.5-flash'
  },
  tts: {
    provider: 'sarvam',
    apiKey: 'YOUR_SARVAM_API_KEY',
    voiceId: 'anushka'
  },
  
  systemPrompt: defaultSystemPrompts.customerService.hindi,
  
  context: {
    businessName: 'Example Corp',
    agentName: 'Maya'
  }
};

export default {
  defaultVoices,
  createSarvamSTTConfig,
  createGeminiLLMConfig,
  createSarvamTTSConfig,
  createReverieTTSConfig,
  defaultSystemPrompts,
  exampleSessionConfig
};
