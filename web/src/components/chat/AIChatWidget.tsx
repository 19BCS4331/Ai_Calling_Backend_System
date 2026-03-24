import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, Send, Loader2, Bot, User, Sparkles } from 'lucide-react';

const SAAS_API_URL = import.meta.env.VITE_SAAS_API_URL || 'http://localhost:3001';

/**
 * Lightweight markdown renderer for chat messages.
 * Supports: **bold**, *italic*, `code`, [links](url), bullet lists (* / -), numbered lists
 */
function renderMarkdown(text: string) {
  // Split into lines to handle block-level elements
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      const Tag = listType;
      elements.push(
        <Tag key={key++} className={`my-1.5 pl-4 space-y-0.5 ${
          listType === 'ul' ? 'list-disc' : 'list-decimal'
        }`}>
          {listItems}
        </Tag>
      );
      listItems = [];
      listType = null;
    }
  };

  // Inline markdown parser
  const parseInline = (line: string): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    // Regex: bold, italic, code, links
    const regex = /(\*\*(.+?)\*\*)|(__(.+?)__)|(\*(.+?)\*)|(_(.+?)_)|(`(.+?)`)|\[(.+?)\]\((.+?)\)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(line)) !== null) {
      // Text before this match
      if (match.index > lastIndex) {
        nodes.push(line.slice(lastIndex, match.index));
      }

      if (match[2]) {
        // **bold**
        nodes.push(<strong key={`b${match.index}`} className="font-semibold">{match[2]}</strong>);
      } else if (match[4]) {
        // __bold__
        nodes.push(<strong key={`b${match.index}`} className="font-semibold">{match[4]}</strong>);
      } else if (match[6]) {
        // *italic*
        nodes.push(<em key={`i${match.index}`}>{match[6]}</em>);
      } else if (match[8]) {
        // _italic_
        nodes.push(<em key={`i${match.index}`}>{match[8]}</em>);
      } else if (match[10]) {
        // `code`
        nodes.push(
          <code key={`c${match.index}`} className="px-1 py-0.5 bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 rounded text-xs font-mono">
            {match[10]}
          </code>
        );
      } else if (match[11] && match[12]) {
        // [link](url)
        nodes.push(
          <a key={`a${match.index}`} href={match[12]} target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 underline underline-offset-2 hover:text-purple-500">
            {match[11]}
          </a>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < line.length) {
      nodes.push(line.slice(lastIndex));
    }

    return nodes.length > 0 ? nodes : [line];
  };

  for (const line of lines) {
    // Unordered list: * item or - item
    const ulMatch = line.match(/^\s*[\*\-]\s+(.+)/);
    // Ordered list: 1. item
    const olMatch = line.match(/^\s*\d+\.\s+(.+)/);

    if (ulMatch) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(<li key={key++}>{parseInline(ulMatch[1])}</li>);
    } else if (olMatch) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(<li key={key++}>{parseInline(olMatch[1])}</li>);
    } else {
      flushList();
      if (line.trim() === '') {
        elements.push(<div key={key++} className="h-1.5" />);
      } else {
        elements.push(<p key={key++} className="my-0.5">{parseInline(line)}</p>);
      }
    }
  }
  flushList();

  return elements;
}

function ChatMarkdown({ content }: { content: string }) {
  const rendered = useMemo(() => renderMarkdown(content), [content]);
  return <div className="chat-md space-y-0">{rendered}</div>;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const SYSTEM_PROMPT = `You are VocaBot, the friendly AI assistant on the VocaCore AI website. You help visitors learn about VocaCore AI's voice AI platform.

## About VocaCore AI
VocaCore AI is an enterprise voice AI platform that lets businesses deploy human-like AI voice agents to handle phone calls at scale. Key facts:

- **What it does**: AI voice agents that make and receive phone calls, handling sales, support, appointment booking, lead qualification, payment reminders, and more.
- **Languages**: Supports 10+ Indian languages (Hindi, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, Malayalam, Odia, Punjabi) plus English.
- **Latency**: Sub-800ms response time for natural conversations.
- **Providers**: Supports multiple AI providers - Gemini, GPT-4, Claude for LLM; Sarvam, ElevenLabs for STT; Cartesia, Google, Sarvam for TTS; Plivo for telephony.
- **Uptime**: 99.9% SLA guarantee.

## Pricing Plans
- **Free**: $0/mo — 50 min, 1 agent, basic analytics, web calls only
- **Starter**: $79/mo — 500 min, 3 agents, 1 phone number, API access
- **Growth**: $349/mo (most popular) — 2,500 min, 10 agents, 5 phone numbers, custom voices, priority support
- **Scale**: $1,299/mo — 10,000 min, unlimited agents, 20 phone numbers, dedicated support, SLA, SSO
- **Enterprise**: Custom pricing for large deployments
- 14-day free trial, no credit card required
- 17% discount on yearly billing

## Key Features
- Telephony integration (Plivo, Twilio, SIP)
- AI-powered natural conversations
- Real-time analytics dashboard
- Knowledge base for agent training
- Tool/function calling (API, MCP, built-in tools)
- Call recording and transcription
- Smart barge-in detection
- BYOK (Bring Your Own Keys) support
- Enterprise security (SOC 2, encryption)

## Use Cases
- Customer support automation (70% ticket deflection)
- Financial services (KYC, payments, loans)
- Healthcare (appointment booking, follow-ups)
- Sales & lead generation (24/7 availability)

## Your Behavior
- Be concise, friendly, and helpful — max 2-3 short paragraphs per response
- Use markdown formatting sparingly (bold for emphasis only)
- If asked about specific technical implementation, suggest they try the live demo on the homepage or contact sales
- Guide users toward signing up for a free trial or trying the live demo
- If you don't know something specific, say so and suggest contacting the team at hello@vocacore.ai
- Never make up features or pricing that isn't listed above
- If asked about competitors, be professional — focus on VocaCore's strengths without disparaging others
- For complex enterprise queries, suggest visiting the Contact page at /contact`;

export function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasGreeted, setHasGreeted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Add greeting when first opened
  useEffect(() => {
    if (isOpen && !hasGreeted) {
      setHasGreeted(true);
      setMessages([{
        id: 'greeting',
        role: 'assistant',
        content: "Hi there! 👋 I'm VocaBot, your AI guide to VocaCore AI. I can help you learn about our voice AI platform, pricing, features, or anything else. What would you like to know?",
        timestamp: new Date()
      }]);
    }
  }, [isOpen, hasGreeted]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Build conversation history for Groq
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }));
      conversationHistory.push({ role: 'user', content: userMessage.content });

      const response = await fetch(`${SAAS_API_URL}/api/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversationHistory,
          systemPrompt: SYSTEM_PROMPT
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content || "Sorry, I couldn't process that. Please try again.",
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having trouble connecting right now. You can reach us directly at hello@vocacore.ai or try again in a moment.",
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestedQuestions = [
    'What is VocaCore AI?',
    'Show me pricing',
    'What languages are supported?',
    'How do I get started?'
  ];

  return (
    <>
      {/* Floating Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-r from-purple-600 to-pink-500 shadow-lg shadow-purple-500/30 flex items-center justify-center text-white hover:shadow-purple-500/50 transition-shadow"
          >
            <MessageSquare size={24} />
            {/* Pulse ring */}
            <span className="absolute inset-0 rounded-full bg-purple-500 animate-ping opacity-20" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-48px)] h-[560px] max-h-[calc(100vh-100px)] rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0d0d14] shadow-2xl shadow-black/20 dark:shadow-black/50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5 bg-gradient-to-r from-purple-600 to-pink-500">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Sparkles size={18} className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">VocaBot</h3>
                  <p className="text-xs text-white/70">AI Assistant · Online</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10">
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  {/* Avatar */}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.role === 'assistant'
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                      : 'bg-gray-100 dark:bg-white/10'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <Bot size={14} className="text-white" />
                    ) : (
                      <User size={14} className="text-gray-500 dark:text-white/60" />
                    )}
                  </div>

                  {/* Bubble */}
                  <div className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white rounded-br-md'
                      : 'bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white/80 border border-gray-100 dark:border-white/5 rounded-bl-md'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <ChatMarkdown content={msg.content} />
                    ) : (
                      msg.content
                    )}
                  </div>
                </motion.div>
              ))}

              {/* Loading indicator */}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-2.5"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                    <Bot size={14} className="text-white" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5">
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Suggested questions */}
              {messages.length <= 1 && !isLoading && (
                <div className="space-y-2 pt-2">
                  <p className="text-xs text-gray-400 dark:text-white/30 px-1">Quick questions:</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedQuestions.map((q) => (
                      <button
                        key={q}
                        onClick={() => {
                          setInput(q);
                          setTimeout(() => {
                            setInput('');
                            const userMsg: Message = {
                              id: Date.now().toString(),
                              role: 'user',
                              content: q,
                              timestamp: new Date()
                            };
                            setMessages(prev => [...prev, userMsg]);
                            setIsLoading(true);
                            // Trigger send
                            fetch(`${SAAS_API_URL}/api/v1/chat`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                messages: [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: q }],
                                systemPrompt: SYSTEM_PROMPT
                              })
                            })
                              .then(res => res.json())
                              .then(data => {
                                setMessages(prev => [...prev, {
                                  id: (Date.now() + 1).toString(),
                                  role: 'assistant',
                                  content: data.content || "Sorry, I couldn't process that.",
                                  timestamp: new Date()
                                }]);
                              })
                              .catch(() => {
                                setMessages(prev => [...prev, {
                                  id: (Date.now() + 1).toString(),
                                  role: 'assistant',
                                  content: "I'm having trouble connecting. Please try again.",
                                  timestamp: new Date()
                                }]);
                              })
                              .finally(() => setIsLoading(false));
                          }, 0);
                        }}
                        className="px-3 py-1.5 text-xs rounded-full border border-purple-200 dark:border-purple-500/20 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-gray-100 dark:border-white/5 bg-white dark:bg-[#0d0d14]">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything about VocaCore AI..."
                  disabled={isLoading}
                  className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 transition-all disabled:opacity-50"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className="w-10 h-10 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 flex items-center justify-center text-white hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-gray-300 dark:text-white/20 text-center mt-2">
                Powered by VocaCore AI · Responses may not be 100% accurate
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
