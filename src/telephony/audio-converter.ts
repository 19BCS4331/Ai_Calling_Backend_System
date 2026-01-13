/**
 * Audio Converter Utilities
 * Handles audio format conversion between telephony and voice pipeline
 */

/**
 * Resample audio from one sample rate to another using linear interpolation
 * @param input - Input buffer (16-bit PCM samples)
 * @param inputRate - Input sample rate (e.g., 8000)
 * @param outputRate - Output sample rate (e.g., 16000)
 * @returns Resampled buffer
 */
export function resample(input: Buffer, inputRate: number, outputRate: number): Buffer {
  if (inputRate === outputRate) {
    return input;
  }

  const ratio = outputRate / inputRate;
  const inputSamples = input.length / 2;  // 16-bit samples
  const outputSamples = Math.floor(inputSamples * ratio);
  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i / ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
    const fraction = srcIndex - srcIndexFloor;

    const sample1 = input.readInt16LE(srcIndexFloor * 2);
    const sample2 = input.readInt16LE(srcIndexCeil * 2);
    
    // Linear interpolation
    const interpolated = Math.round(sample1 + (sample2 - sample1) * fraction);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
  }

  return output;
}

/**
 * Convert μ-law encoded audio to linear 16-bit PCM
 * @param mulawData - μ-law encoded buffer
 * @returns Linear 16-bit PCM buffer
 */
export function mulawToLinear(mulawData: Buffer): Buffer {
  const output = Buffer.alloc(mulawData.length * 2);

  for (let i = 0; i < mulawData.length; i++) {
    const mulaw = mulawData[i];
    const linear = mulawDecode(mulaw);
    output.writeInt16LE(linear, i * 2);
  }

  return output;
}

/**
 * Convert linear 16-bit PCM to μ-law encoding
 * @param linearData - Linear 16-bit PCM buffer
 * @returns μ-law encoded buffer
 */
export function linearToMulaw(linearData: Buffer): Buffer {
  const output = Buffer.alloc(linearData.length / 2);

  for (let i = 0; i < linearData.length / 2; i++) {
    const linear = linearData.readInt16LE(i * 2);
    const mulaw = mulawEncode(linear);
    output[i] = mulaw;
  }

  return output;
}

/**
 * Decode a single μ-law byte to 16-bit linear PCM
 */
function mulawDecode(mulaw: number): number {
  // Invert all bits
  mulaw = ~mulaw & 0xFF;
  
  const sign = (mulaw & 0x80) !== 0;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0F;
  
  let magnitude = ((mantissa << 3) + 0x84) << exponent;
  magnitude -= 0x84;
  
  return sign ? -magnitude : magnitude;
}

/**
 * Encode a 16-bit linear PCM sample to μ-law
 */
function mulawEncode(sample: number): number {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;

  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  
  sample = Math.min(sample, MULAW_MAX);
  sample += MULAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent--;
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const mulaw = ~(sign | (exponent << 4) | mantissa) & 0xFF;
  
  return mulaw;
}

/**
 * Convert telephony audio to pipeline format
 * Telephony: 8kHz, linear16 or mulaw
 * Pipeline: 16kHz, linear16
 */
export function telephonyToPipeline(
  audioData: Buffer, 
  encoding: 'linear16' | 'mulaw',
  inputSampleRate: number = 8000
): Buffer {
  let linear: Buffer;
  
  if (encoding === 'mulaw') {
    linear = mulawToLinear(audioData);
  } else {
    linear = audioData;
  }
  
  // Resample to 16kHz for STT
  return resample(linear, inputSampleRate, 16000);
}

/**
 * Convert pipeline audio to telephony format
 * Pipeline TTS output: various sample rates, linear16
 * Telephony: 8kHz, linear16
 */
export function pipelineToTelephony(
  audioData: Buffer,
  inputSampleRate: number,
  outputEncoding: 'linear16' | 'mulaw' = 'linear16'
): Buffer {
  // Resample to 8kHz for telephony
  const resampled = resample(audioData, inputSampleRate, 8000);
  
  if (outputEncoding === 'mulaw') {
    return linearToMulaw(resampled);
  }
  
  return resampled;
}

/**
 * Calculate audio duration in milliseconds
 */
export function getAudioDurationMs(buffer: Buffer, sampleRate: number, bytesPerSample: number = 2): number {
  const samples = buffer.length / bytesPerSample;
  return (samples / sampleRate) * 1000;
}
