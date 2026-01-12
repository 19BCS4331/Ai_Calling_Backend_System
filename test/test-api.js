/**
 * Simple API Test Script
 * Run with: node test/test-api.js
 */

const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:3000';

// Replace with your actual API keys
const CONFIG = {
  sarvamKey: process.env.SARVAM_API_KEY || 'YOUR_SARVAM_KEY',
  geminiKey: process.env.GEMINI_API_KEY || 'YOUR_GEMINI_KEY'
};

async function testHealthEndpoint() {
  console.log('\n📋 Testing Health Endpoint...');
  try {
    const response = await fetch('http://localhost:3000/health');
    const data = await response.json();
    console.log('✅ Health:', data);
  } catch (err) {
    console.error('❌ Health check failed:', err.message);
  }
}

async function testToolsEndpoint() {
  console.log('\n🔧 Testing Tools Endpoint...');
  try {
    const response = await fetch('http://localhost:3000/api/v1/tools', {
      headers: { 'X-API-Key': 'test' }
    });
    const data = await response.json();
    console.log('✅ Available tools:', data.tools.map(t => t.name).join(', '));
  } catch (err) {
    console.error('❌ Tools endpoint failed:', err.message);
  }
}

async function testWebSocket() {
  console.log('\n🔌 Testing WebSocket Connection...');
  
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER_URL);
    
    ws.on('open', () => {
      console.log('✅ WebSocket connected');
      
      // Start a session
      console.log('\n🎙️ Starting voice session...');
      ws.send(JSON.stringify({
        type: 'start_session',
        tenantId: 'test-script',
        config: {
          language: 'hi-IN',
          systemPrompt: 'You are a helpful assistant. Respond briefly.',
          stt: {
            provider: 'sarvam',
            apiKey: CONFIG.sarvamKey
          },
          llm: {
            provider: 'gemini',
            apiKey: CONFIG.geminiKey,
            model: 'gemini-2.5-flash'
          },
          tts: {
            provider: 'sarvam',
            apiKey: CONFIG.sarvamKey,
            voiceId: 'anushka'
          }
        }
      }));
    });
    
    ws.on('message', (data) => {
      if (Buffer.isBuffer(data)) {
        console.log(`🔊 Received audio chunk: ${data.length} bytes`);
        return;
      }
      
      try {
        const msg = JSON.parse(data.toString());
        
        switch (msg.type) {
          case 'connected':
            console.log(`✅ Connection ID: ${msg.connectionId}`);
            break;
          case 'session_started':
            console.log(`✅ Session started: ${msg.sessionId}`);
            console.log('\n📝 Session is ready!');
            console.log('   The session is now waiting for audio input.');
            console.log('   Use the HTML test client for microphone input.');
            
            // End session after 5 seconds for this test
            setTimeout(() => {
              console.log('\n🛑 Ending test session...');
              ws.send(JSON.stringify({
                type: 'end_session',
                sessionId: msg.sessionId
              }));
            }, 5000);
            break;
          case 'session_ended':
            console.log('✅ Session ended');
            console.log('📊 Metrics:', JSON.stringify(msg.metrics, null, 2));
            ws.close();
            resolve();
            break;
          case 'error':
            console.error('❌ Error:', msg.error);
            break;
          default:
            console.log(`📨 ${msg.type}:`, msg);
        }
      } catch (e) {
        console.log('📨 Raw message:', data.toString().substring(0, 100));
      }
    });
    
    ws.on('error', (err) => {
      console.error('❌ WebSocket error:', err.message);
      resolve();
    });
    
    ws.on('close', () => {
      console.log('🔌 WebSocket closed');
      resolve();
    });
  });
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('   AI Voice Calling Backend - Test Suite   ');
  console.log('═══════════════════════════════════════════');
  
  await testHealthEndpoint();
  await testToolsEndpoint();
  await testWebSocket();
  
  console.log('\n═══════════════════════════════════════════');
  console.log('   Tests Complete!                         ');
  console.log('═══════════════════════════════════════════');
  console.log('\n💡 For full voice testing, open test/test-client.html in a browser');
}

main().catch(console.error);
