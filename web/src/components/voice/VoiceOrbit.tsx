import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Volume2 } from 'lucide-react';

interface VoiceAgent {
  id: number;
  name: string;
  role: string;
  language: string;
  color: string;
  gradient: string;
  ring: string;
  initials: string;
  audioSrc: string;
  photoSrc: string;
  angle: number; // degrees on orbit
}

const AGENTS: VoiceAgent[] = [
  {
    id: 1,
    name: 'Grace',
    role: 'Sales Agent',
    language: 'English',
    color: 'from-purple-500 to-violet-600',
    gradient: 'bg-gradient-to-br from-purple-500 to-violet-600',
    ring: 'ring-purple-500/40',
    initials: 'GR',
    audioSrc: '/audio/Grace.wav',
    photoSrc: '/avatars/grace.png',
    angle: 0,
  },
  {
    id: 2,
    name: 'Arjun',
    role: 'Support Agent',
    language: 'English',
    color: 'from-pink-500 to-rose-600',
    gradient: 'bg-gradient-to-br from-pink-500 to-rose-600',
    ring: 'ring-pink-500/40',
    initials: 'AR',
    audioSrc: '/audio/Arjun.wav',
    photoSrc: '/avatars/Arjun.jpeg',
    angle: 72,
  },
  {
    id: 3,
    name: 'George',
    role: 'Booking Agent',
    language: 'English',
    color: 'from-blue-500 to-cyan-500',
    gradient: 'bg-gradient-to-br from-blue-500 to-cyan-500',
    ring: 'ring-blue-500/40',
    initials: 'GE',
    audioSrc: '/audio/George.wav',
    photoSrc: '/avatars/George.webp',
    angle: 144,
  },
  {
    id: 4,
    name: 'Jacqueline',
    role: 'Collections Agent',
    language: 'English',
    color: 'from-emerald-500 to-teal-500',
    gradient: 'bg-gradient-to-br from-emerald-500 to-teal-500',
    ring: 'ring-emerald-500/40',
    initials: 'JQ',
    audioSrc: '/audio/jacqueline.wav',
    photoSrc: '/avatars/jacqueline.jpg',
    angle: 216,
  },
  {
    id: 5,
    name: 'Riya',
    role: 'Lead Qualifier',
    language: 'English',
    color: 'from-orange-500 to-amber-500',
    gradient: 'bg-gradient-to-br from-orange-500 to-amber-500',
    ring: 'ring-orange-500/40',
    initials: 'RI',
    audioSrc: '/audio/Riya.wav',
    photoSrc: '/avatars/Riya.png',
    angle: 288,
  },
];

const ORBIT_RADIUS = 195; // px from center
const AVATAR_SIZE = 108; // px

interface AudioState {
  id: number | null;
  playing: boolean;
  progress: number;
}

export function VoiceOrbit() {
  const [rotation, setRotation] = useState(0);
  const [paused, setPaused] = useState(false);
  const [_activeAgent, setActiveAgent] = useState<VoiceAgent | null>(null);
  const [audio, setAudio] = useState<AudioState>({ id: null, playing: false, progress: 0 });
  const [tooltip, setTooltip] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const rotRef = useRef(0);

  // Smooth rotation via rAF
  useEffect(() => {
    const animate = (time: number) => {
      if (!paused) {
        const delta = lastTimeRef.current ? time - lastTimeRef.current : 0;
        rotRef.current = (rotRef.current + delta * 0.012) % 360;
        setRotation(rotRef.current);
      }
      lastTimeRef.current = time;
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paused]);

  // Audio progress tracking
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      setAudio(a => ({ ...a, progress: el.duration ? el.currentTime / el.duration : 0 }));
    };
    const onEnded = () => {
      setAudio({ id: null, playing: false, progress: 0 });
      setPaused(false);
    };
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
    };
  }, [audioRef.current]);

  const handlePlay = (agent: VoiceAgent, e: React.MouseEvent) => {
    e.stopPropagation();
    // If same agent — toggle
    if (audio.id === agent.id) {
      if (audio.playing) {
        audioRef.current?.pause();
        setAudio(a => ({ ...a, playing: false }));
        setPaused(false);
      } else {
        audioRef.current?.play().catch(() => {});
        setAudio(a => ({ ...a, playing: true }));
        setPaused(true);
      }
      return;
    }
    // Switch to new agent
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = agent.audioSrc;
      audioRef.current.load();
      audioRef.current.play().catch(() => {});
    }
    setAudio({ id: agent.id, playing: true, progress: 0 });
    setActiveAgent(agent);
    setPaused(true); // slow orbit while playing
  };

  const containerSize = ORBIT_RADIUS * 2 + AVATAR_SIZE + 40;

  return (
    <div className="relative flex items-center justify-center select-none" style={{ width: containerSize, height: containerSize }}>
      <audio ref={audioRef} />

      {/* Orbit track rings */}
      <div
        className="absolute rounded-full border border-dashed border-purple-300/30 dark:border-purple-500/20"
        style={{ width: ORBIT_RADIUS * 2 + AVATAR_SIZE, height: ORBIT_RADIUS * 2 + AVATAR_SIZE }}
      />
      <div
        className="absolute rounded-full border border-purple-200/20 dark:border-white/5"
        style={{ width: ORBIT_RADIUS * 2 + AVATAR_SIZE + 28, height: ORBIT_RADIUS * 2 + AVATAR_SIZE + 28 }}
      />

      {/* Central pulsing core */}
      <div className="absolute inset-0 flex items-center justify-center">
        {/* Outer glow pulse */}
        <motion.div
          className="absolute w-28 h-28 rounded-full bg-purple-400/10 dark:bg-purple-500/10"
          animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0.1, 0.4] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-20 h-20 rounded-full bg-purple-400/15 dark:bg-purple-500/15"
          animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0.2, 0.5] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
        />
        {/* Core circle */}
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 shadow-xl shadow-purple-500/30 flex items-center justify-center">
          <Volume2 size={22} className="text-white" />
          {/* Soundwave bars */}
          <div className="absolute -bottom-6 flex items-end gap-[3px]">
            {[4, 7, 10, 7, 4].map((h, i) => (
              <motion.div
                key={i}
                className="w-1 bg-purple-400/60 rounded-full"
                style={{ height: h }}
                animate={{ height: [h, h * 2.2, h] }}
                transition={{ duration: 0.7 + i * 0.1, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Revolving avatars */}
      {AGENTS.map((agent) => {
        const angleRad = ((agent.angle + rotation) * Math.PI) / 180;
        const x = Math.cos(angleRad) * ORBIT_RADIUS;
        const y = Math.sin(angleRad) * ORBIT_RADIUS;
        const isPlaying = audio.id === agent.id && audio.playing;
        const isActive = audio.id === agent.id;

        return (
          <div
            key={agent.id}
            className="absolute"
            style={{
              left: '50%',
              top: '50%',
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
            }}
            onMouseEnter={() => setTooltip(agent.id)}
            onMouseLeave={() => setTooltip(null)}
          >
            {/* Tooltip */}
            <AnimatePresence>
              {tooltip === agent.id && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.92 }}
                  transition={{ duration: 0.15 }}
                  className="absolute z-20 pointer-events-none"
                  style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 10 }}
                >
                  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 shadow-xl whitespace-nowrap">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white">{agent.name}</p>
                    <p className="text-[11px] text-gray-400 dark:text-white/40">{agent.role} · {agent.language}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Avatar button */}
            <motion.button
              onClick={(e) => handlePlay(agent, e)}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.94 }}
              className="relative flex items-center justify-center focus:outline-none"
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            >
              {/* Active ring pulse */}
              {isActive && (
                <motion.div
                  className={`absolute inset-0 rounded-full bg-gradient-to-br ${agent.color} opacity-30`}
                  animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0, 0.3] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}

              {/* Progress ring (SVG) */}
              <svg className="absolute inset-0" width={AVATAR_SIZE} height={AVATAR_SIZE}>
                <circle
                  cx={AVATAR_SIZE / 2}
                  cy={AVATAR_SIZE / 2}
                  r={(AVATAR_SIZE / 2) - 3}
                  fill="none"
                  stroke="rgba(168,85,247,0.15)"
                  strokeWidth="2.5"
                />
                {isActive && (
                  <motion.circle
                    cx={AVATAR_SIZE / 2}
                    cy={AVATAR_SIZE / 2}
                    r={(AVATAR_SIZE / 2) - 3}
                    fill="none"
                    stroke="url(#progress-grad)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * ((AVATAR_SIZE / 2) - 3)}
                    strokeDashoffset={2 * Math.PI * ((AVATAR_SIZE / 2) - 3) * (1 - audio.progress)}
                    style={{ rotate: '-90deg', transformOrigin: 'center', transform: 'rotate(-90deg)', transformBox: 'fill-box' }}
                  />
                )}
                <defs>
                  <linearGradient id="progress-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#a855f7" />
                    <stop offset="100%" stopColor="#ec4899" />
                  </linearGradient>
                </defs>
              </svg>

              {/* Avatar circle */}
              <div className={`relative w-24 h-24 rounded-full ${agent.gradient} flex items-center justify-center shadow-lg ring-2 ${agent.ring} overflow-hidden`}>
                {/* Photo — falls back to initials if missing */}
                <img
                  src={agent.photoSrc}
                  alt={agent.name}
                  className="absolute inset-0 w-full h-full object-cover rounded-full"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                {/* Initials shown when photo absent */}
                <span className="text-white font-bold text-sm select-none">{agent.initials}</span>

                {/* Play/pause overlay on hover */}
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-200">
                  {isPlaying
                    ? <Pause size={18} className="text-white" />
                    : <Play size={18} className="text-white ml-0.5" />
                  }
                </div>
              </div>

              {/* Soundwave indicator when playing */}
              {isPlaying && (
                <div className="absolute -bottom-4 flex items-end gap-[2px]">
                  {[3, 6, 8, 6, 3].map((h, i) => (
                    <motion.div
                      key={i}
                      className="w-[3px] rounded-full bg-purple-400"
                      style={{ height: h }}
                      animate={{ height: [h, h * 2, h] }}
                      transition={{ duration: 0.5 + i * 0.08, repeat: Infinity, ease: 'easeInOut', delay: i * 0.1 }}
                    />
                  ))}
                </div>
              )}
            </motion.button>
          </div>
        );
      })}
    </div>
  );
}
