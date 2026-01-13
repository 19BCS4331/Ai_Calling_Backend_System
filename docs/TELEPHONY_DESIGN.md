# Plivo Telephony Integration - Design Document

## 1. Research Summary

### 1.1 Plivo Audio Streaming Protocol

Based on official Plivo documentation:

**WebSocket Events FROM Plivo:**
- `start` - Sent when stream connects, contains streamId, callId, from, to
- `media` - Audio data with base64-encoded payload
- `stop` - Stream ended
- `dtmf` - Keypress detected

**WebSocket Events TO Plivo:**
- `playAudio` - Send audio to caller with base64-encoded payload
- `clearAudio` - Clear buffered audio (for barge-in)

**Audio Formats:**
- audio/x-l16 (Linear16 PCM) at 8000 or 16000 Hz
- audio/x-mulaw at 8000 Hz
- All payloads are base64 encoded

### 1.2 Existing Voice Pipeline Interface

The VoicePipeline class expects:
- Input: processAudioChunk(Buffer) - Raw PCM 16-bit, 16kHz
- Output: tts_audio_chunk event with raw PCM Buffer

The pipeline is transport-agnostic.

## 2. Architecture Design

### 2.1 Module Structure

```
src/telephony/
  index.ts                 - Public exports
  types.ts                 - Telephony-specific types
  telephony-manager.ts     - Manages all telephony sessions
  audio-converter.ts       - Audio format conversion
  adapters/
    base-adapter.ts        - Abstract telephony adapter
    plivo-adapter.ts       - Plivo implementation
```

### 2.2 Data Flow

```
Phone Call
    ↓
Plivo (PSTN Gateway)
    ↓ WebSocket (wss://.../telephony/plivo/stream)
PlivoAdapter
    ↓ handleStreamMessage() - parse JSON, decode base64
    ↓ emitAudioPacket()
TelephonyManager
    ↓ handleAudioReceived() - convert 8kHz→16kHz
VoicePipeline.processAudioChunk()
    ↓
STT → LLM → TTS
    ↓
VoicePipeline emits 'tts_audio_chunk'
    ↓
TelephonyManager.setupPipelineEvents()
    ↓ convert to 8kHz, encode base64
PlivoAdapter.sendAudio()
    ↓ WebSocket playAudio event
Plivo
    ↓
Phone Call (audio played to caller)
```

### 2.3 Audio Conversion

**Inbound (Plivo -> Pipeline):**
- Decode base64 payload from media event
- If mulaw: convert to linear16
- Resample from 8kHz to 16kHz (linear interpolation)
- Forward to pipeline.processAudioChunk()

**Outbound (Pipeline -> Plivo):**
- Receive raw PCM from TTS (22050Hz for Sarvam, 44100Hz for Cartesia)
- Resample to 8kHz for telephony
- Encode to base64
- Send as playAudio event with contentType "audio/x-l16"

## 3. API Endpoints

### Webhooks (called by Plivo)
- `POST /telephony/plivo/answer` - Returns XML to start audio stream
- `POST /telephony/plivo/status` - Receives call status updates
- `WSS /telephony/plivo/stream` - Bidirectional audio stream

### REST API
- `POST /api/v1/telephony/call` - Make outbound call
- `DELETE /api/v1/telephony/call/:callId` - End call

## 4. Configuration

Environment variables:
```
ENABLE_TELEPHONY=true
PLIVO_AUTH_ID=your_auth_id
PLIVO_AUTH_TOKEN=your_auth_token
PLIVO_FROM_NUMBER=+1234567890
WEBHOOK_BASE_URL=https://your-domain.com
```

## 5. Key Design Decisions

1. **Separate Subsystem:** Telephony is completely isolated from the AI pipeline
2. **Adapter Pattern:** Easy to add new telephony providers (Twilio, etc.)
3. **No Pipeline Changes:** The voice pipeline remains unchanged
4. **Sample Rate Handling:** All conversion happens in the telephony layer
5. **Event-Driven:** Uses EventEmitter pattern for loose coupling

## 6. Adding New Telephony Providers

To add a new provider (e.g., Twilio):

1. Create `src/telephony/adapters/twilio-adapter.ts`
2. Extend `BaseTelephonyAdapter`
3. Implement required methods:
   - `init()` - Initialize with credentials
   - `makeCall()` - Initiate outbound calls
   - `endCall()` - Terminate calls
   - `sendAudio()` - Send audio to caller
   - `clearAudio()` - Handle barge-in
   - `getAnswerXml()` - Return provider-specific XML
   - `handleWebhook()` - Process webhooks
4. Add provider case in `TelephonyManager.createAdapter()`
5. Add routes in `APIServer.setupTelephonyRoutes()`

## 7. Limitations & Trade-offs

1. **Single audio format:** Currently uses linear16 8kHz for all Plivo communication
2. **No call recording:** Recording must be configured separately in Plivo
3. **No call transfer:** Transfer functionality not yet implemented
4. **Synchronous webhooks:** Answer webhook blocks until XML is returned
