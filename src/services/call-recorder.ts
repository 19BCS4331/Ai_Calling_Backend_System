/**
 * CallRecorder — Non-blocking call recording service.
 * 
 * Buffers raw PCM audio from both user (mic) and agent (TTS) during a call,
 * then mixes and encodes to WAV on call end. Upload to Supabase storage is
 * fire-and-forget to avoid adding latency.
 * 
 * Each audio chunk is timestamped relative to recording start so that user
 * and agent audio are placed at the correct position in the timeline during
 * mixing, preventing voice overlap artifacts.
 * 
 * Audio format assumptions:
 *   - User audio: 16kHz 16-bit PCM (pipeline standard)
 *   - TTS audio: varies by provider, resampled to 16kHz before mixing
 */

import { createClient } from '@supabase/supabase-js';
import { Logger } from '../types';

const RECORDING_SAMPLE_RATE = 16000; // 16kHz mono output
const BYTES_PER_SAMPLE = 2; // 16-bit
const BYTES_PER_MS = (RECORDING_SAMPLE_RATE * BYTES_PER_SAMPLE) / 1000; // 32 bytes per ms

interface TimestampedChunk {
  /** Milliseconds since recording start */
  offsetMs: number;
  /** 16kHz 16-bit PCM data */
  pcm: Buffer;
}

interface RecorderConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  bucket?: string;
}

export class CallRecorder {
  private userChunks: TimestampedChunk[] = [];
  private agentChunks: TimestampedChunk[] = [];
  private isRecording = false;
  private startTime = 0;
  private logger: Logger;
  private config: RecorderConfig;
  private callId: string;
  private orgId: string;

  // Agent audio playback tracking:
  // TTS chunks arrive faster than real-time (entire turn streams in < 2s but plays for 10s+).
  // We track when each turn's first chunk arrives (wall-clock) and use accumulated
  // audio duration to calculate the correct playback position for each chunk.
  private agentTurnStartMs = 0;      // Wall-clock offset when current TTS turn started
  private agentTurnAccumBytes = 0;   // Accumulated 16kHz PCM bytes in current turn
  private agentLastChunkTime = 0;    // Wall-clock time of last agent chunk (to detect new turns)

  constructor(
    callId: string,
    orgId: string,
    config: RecorderConfig,
    logger: Logger
  ) {
    this.callId = callId;
    this.orgId = orgId;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Start recording. Call this when the session begins.
   */
  start(): void {
    this.isRecording = true;
    this.startTime = Date.now();
    this.userChunks = [];
    this.agentChunks = [];
    this.agentTurnStartMs = 0;
    this.agentTurnAccumBytes = 0;
    this.agentLastChunkTime = 0;
    this.logger.debug('CallRecorder started', { callId: this.callId });
  }

  /**
   * Push user (microphone) audio. Called from processAudioChunk.
   * Already 16kHz 16-bit PCM from the pipeline.
   * Non-blocking — just appends to array with timestamp.
   */
  pushUserAudio(chunk: Buffer): void {
    if (!this.isRecording) return;
    this.userChunks.push({
      offsetMs: Date.now() - this.startTime,
      pcm: chunk,
    });
  }

  /**
   * Push agent (TTS) audio. Called from tts_audio_chunk event.
   * May be at different sample rates or WAV-wrapped — we handle both.
   * Non-blocking — just appends to array with timestamp.
   * 
   * Agent timestamps use playback position, not arrival time:
   *   offset = turnStartMs + (accumulatedBytes / bytesPerMs)
   * This ensures 10s of TTS audio is spread across 10s of recording
   * even though it arrives from the provider in < 2 seconds.
   */
  pushAgentAudio(chunk: Buffer, sampleRate: number): void {
    if (!this.isRecording) return;

    let pcmChunk = chunk;

    // Strip WAV header if present (web mode TTS adds WAV headers)
    if (chunk.length > 44 && chunk.toString('ascii', 0, 4) === 'RIFF') {
      pcmChunk = chunk.subarray(44);
    }

    // Resample to 16kHz if needed
    if (sampleRate !== RECORDING_SAMPLE_RATE && sampleRate > 0) {
      pcmChunk = this.resample(pcmChunk, sampleRate, RECORDING_SAMPLE_RATE);
    }

    if (pcmChunk.length === 0) return;

    const now = Date.now() - this.startTime;

    // Detect new TTS turn: if >500ms gap since last chunk, it's a new turn
    if (this.agentLastChunkTime === 0 || (now - this.agentLastChunkTime) > 500) {
      this.agentTurnStartMs = now;
      this.agentTurnAccumBytes = 0;
    }
    this.agentLastChunkTime = now;

    // Calculate playback position: turn start + accumulated audio duration
    const playbackOffsetMs = this.agentTurnStartMs + 
      Math.floor(this.agentTurnAccumBytes / BYTES_PER_MS);

    this.agentChunks.push({
      offsetMs: playbackOffsetMs,
      pcm: pcmChunk,
    });

    // Accumulate bytes for next chunk's offset
    this.agentTurnAccumBytes += pcmChunk.length;
  }

  /**
   * Notify the recorder that a barge-in occurred, resetting the agent turn tracker.
   * This ensures the next TTS turn starts fresh after interruption.
   */
  notifyBargeIn(): void {
    this.agentTurnStartMs = 0;
    this.agentTurnAccumBytes = 0;
    this.agentLastChunkTime = 0;
  }

  /**
   * Stop recording and upload to Supabase storage.
   * Returns the public URL of the recording, or null on failure.
   * This is fire-and-forget safe — errors are logged but not thrown.
   */
  async stopAndUpload(): Promise<string | null> {
    this.isRecording = false;
    const durationMs = Date.now() - this.startTime;

    const totalUserBytes = this.userChunks.reduce((s, c) => s + c.pcm.length, 0);
    const totalAgentBytes = this.agentChunks.reduce((s, c) => s + c.pcm.length, 0);

    this.logger.info('CallRecorder stopping', {
      callId: this.callId,
      durationMs,
      userChunks: this.userChunks.length,
      agentChunks: this.agentChunks.length,
      userBytes: totalUserBytes,
      agentBytes: totalAgentBytes,
    });

    // Need at least some audio to create a recording
    if (totalUserBytes === 0 && totalAgentBytes === 0) {
      this.logger.warn('No audio captured, skipping recording upload');
      return null;
    }

    try {
      // Render each track onto a timeline buffer, then mix
      const userTrack = this.renderTrack(this.userChunks, durationMs);
      const agentTrack = this.renderTrack(this.agentChunks, durationMs);
      const mixed = this.mixTracks(userTrack, agentTrack);

      // Encode as WAV
      const wav = this.encodeWav(mixed, RECORDING_SAMPLE_RATE, 1, 16);

      // Upload to Supabase storage
      const bucket = this.config.bucket || 'call-recordings';
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const path = `${this.orgId}/${date}/${this.callId}.wav`;

      const supabase = createClient(
        this.config.supabaseUrl,
        this.config.supabaseServiceKey
      );

      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, wav, {
          contentType: 'audio/wav',
          upsert: true,
        });

      if (error) {
        this.logger.error('Failed to upload recording', {
          callId: this.callId,
          error: error.message,
        });
        return null;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(path);

      const publicUrl = urlData.publicUrl;

      this.logger.info('Recording uploaded', {
        callId: this.callId,
        path,
        sizeBytes: wav.length,
        durationMs,
        url: publicUrl,
      });

      // Free memory
      this.userChunks = [];
      this.agentChunks = [];

      return publicUrl;
    } catch (err) {
      this.logger.error('CallRecorder upload error', {
        callId: this.callId,
        error: (err as Error).message,
      });
      return null;
    }
  }

  /**
   * Render timestamped chunks onto a single continuous PCM buffer.
   * Each chunk is placed at its correct byte offset based on its timestamp.
   * Overlapping regions are summed (additive mix with clipping).
   */
  private renderTrack(chunks: TimestampedChunk[], totalDurationMs: number): Buffer {
    if (chunks.length === 0) {
      // Allocate buffer for full duration even if no chunks
      const totalBytes = Math.ceil(totalDurationMs * BYTES_PER_MS);
      // Align to sample boundary
      return Buffer.alloc(totalBytes - (totalBytes % BYTES_PER_SAMPLE));
    }

    // Determine total buffer length from the last chunk's end position
    let maxEndByte = 0;
    for (const chunk of chunks) {
      const startByte = Math.floor(chunk.offsetMs * BYTES_PER_MS);
      const alignedStart = startByte - (startByte % BYTES_PER_SAMPLE);
      const endByte = alignedStart + chunk.pcm.length;
      if (endByte > maxEndByte) maxEndByte = endByte;
    }

    // Also ensure we cover the full call duration
    const durationBytes = Math.ceil(totalDurationMs * BYTES_PER_MS);
    const alignedDuration = durationBytes - (durationBytes % BYTES_PER_SAMPLE);
    const bufferLen = Math.max(maxEndByte, alignedDuration);

    const track = Buffer.alloc(bufferLen);

    for (const chunk of chunks) {
      const startByte = Math.floor(chunk.offsetMs * BYTES_PER_MS);
      const alignedStart = startByte - (startByte % BYTES_PER_SAMPLE);

      // Copy samples additively (handles any overlap within the same track)
      for (let i = 0; i < chunk.pcm.length - 1; i += BYTES_PER_SAMPLE) {
        const destOffset = alignedStart + i;
        if (destOffset + 1 >= track.length) break;

        const existing = track.readInt16LE(destOffset);
        const incoming = chunk.pcm.readInt16LE(i);
        const summed = Math.max(-32768, Math.min(32767, existing + incoming));
        track.writeInt16LE(summed, destOffset);
      }
    }

    return track;
  }

  /**
   * Mix two time-aligned mono PCM tracks into one by summing samples with clipping.
   */
  private mixTracks(trackA: Buffer, trackB: Buffer): Buffer {
    const maxLen = Math.max(trackA.length, trackB.length);
    const output = Buffer.alloc(maxLen);

    for (let i = 0; i < maxLen; i += BYTES_PER_SAMPLE) {
      const sampleA = i + 1 < trackA.length ? trackA.readInt16LE(i) : 0;
      const sampleB = i + 1 < trackB.length ? trackB.readInt16LE(i) : 0;

      const mixed = Math.max(-32768, Math.min(32767, sampleA + sampleB));
      output.writeInt16LE(mixed, i);
    }

    return output;
  }

  /**
   * Simple linear resampling for 16-bit PCM mono.
   */
  private resample(input: Buffer, fromRate: number, toRate: number): Buffer {
    if (fromRate === toRate) return input;

    const ratio = fromRate / toRate;
    const inputSamples = input.length / BYTES_PER_SAMPLE;
    const outputSamples = Math.floor(inputSamples / ratio);
    const output = Buffer.alloc(outputSamples * BYTES_PER_SAMPLE);

    for (let i = 0; i < outputSamples; i++) {
      const srcIndex = Math.min(Math.floor(i * ratio), inputSamples - 1);
      const sample = input.readInt16LE(srcIndex * BYTES_PER_SAMPLE);
      output.writeInt16LE(sample, i * BYTES_PER_SAMPLE);
    }

    return output;
  }

  /**
   * Encode PCM data as a WAV file.
   */
  private encodeWav(
    pcm: Buffer,
    sampleRate: number,
    channels: number,
    bitsPerSample: number
  ): Buffer {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcm.length;
    const headerSize = 44;
    const fileSize = headerSize + dataSize;

    const header = Buffer.alloc(headerSize);

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize - 8, 4);
    header.write('WAVE', 8);

    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
    header.writeUInt16LE(1, 20);  // AudioFormat (PCM)
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcm]);
  }
}
