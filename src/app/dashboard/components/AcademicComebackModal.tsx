"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import gsap from "gsap";
import { TextPlugin } from "gsap/TextPlugin";
import confetti from "canvas-confetti";
import type { CookedTier } from "@/generated/prisma";
import type { CelebrationContext } from "@/lib/services/task.service";
import { Sparkles, Share2, Volume2, VolumeX, Flame, ArrowRight, Check } from "lucide-react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(TextPlugin);
}

const TIER_LABELS: Record<CookedTier, string> = {
  MAIN_CHARACTER: "Main Character",
  LET_HIM_COOK: "Let Him Cook",
  SLIGHTLY_COOKED: "Slightly Cooked",
  OVERCOOKED: "Overcooked",
};

const TIER_COLORS: Record<CookedTier, { bg: string; text: string; border: string; glow: string }> = {
  MAIN_CHARACTER: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    glow: "shadow-emerald-500/20",
  },
  LET_HIM_COOK: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
    glow: "shadow-amber-500/20",
  },
  SLIGHTLY_COOKED: {
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-500/30",
    glow: "shadow-orange-500/20",
  },
  OVERCOOKED: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/30",
    glow: "shadow-red-500/20",
  },
};

interface AcademicComebackModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: CelebrationContext | null;
}

/**
 * Play an ascending synthesized celebratory major chord arpeggio chime at 50% volume.
 */
function playCelebrationSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const playNote = (freq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      // Volume is set to 50% (0.5 max gain ramped to 0)
      gainNode.gain.setValueAtTime(0.5, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    // C5 (523.25Hz), E5 (659.25Hz), G5 (783.99Hz), C6 (1046.50Hz)
    playNote(523.25, now, 0.25);
    playNote(659.25, now + 0.12, 0.25);
    playNote(783.99, now + 0.24, 0.25);
    playNote(1046.50, now + 0.36, 0.5);
  } catch (err) {
    console.error("Failed to play celebration sound:", err);
  }
}

export function AcademicComebackModal({
  isOpen,
  onClose,
  context,
}: AcademicComebackModalProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Read sound settings on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("soundEnabled") !== "false";
      setSoundEnabled(saved);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !context) return;

    // 1. Confetti celebration animation (3s duration, 200+ particles)
    const duration = 3000;
    const animationEnd = Date.now() + duration;

    const confettiInterval = setInterval(() => {
      if (Date.now() > animationEnd) {
        clearInterval(confettiInterval);
        return;
      }

      // Launch particles from left edge
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.8 },
        colors: ["#a855f7", "#ec4899", "#3b82f6", "#eab308"],
      });

      // Launch particles from right edge
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.8 },
        colors: ["#a855f7", "#ec4899", "#3b82f6", "#eab308"],
      });
    }, 45);

    // 2. Play celebratory sound effect (if enabled) at 50% volume
    if (soundEnabled) {
      playCelebrationSound();
    }

    // 3. Animated text with GSAP
    if (titleRef.current) {
      gsap.killTweensOf(titleRef.current);
      gsap.fromTo(
        titleRef.current,
        { opacity: 0, scale: 0.6, y: -20 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.9,
          ease: "bounce.out",
          text: "THE ACADEMIC COMEBACK IS REAL!",
        }
      );
    }

    return () => {
      clearInterval(confettiInterval);
    };
  }, [isOpen, context, soundEnabled]);

  if (!context) return null;

  const { stressDrop, oldTier, newTier } = context;

  const handleToggleSound = () => {
    const nextVal = !soundEnabled;
    setSoundEnabled(nextVal);
    localStorage.setItem("soundEnabled", String(nextVal));
  };

  /**
   * Generate a temporary Academic Wrapped card snapshot with celebration context.
   * Creates a 1080x1920 canvas (9:16 aspect ratio) with celebration data and triggers
   * Web Share API (mobile) or download (desktop).
   * 
   * Requirements: 12.9 (social share integration)
   */
  const handleShare = async () => {
    try {
      // Create canvas for Academic Wrapped card (1080x1920 - 9:16 aspect ratio)
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Canvas context not available');
      }

      // Background gradient (purple to black)
      const gradient = ctx.createLinearGradient(0, 0, 0, 1920);
      gradient.addColorStop(0, '#581c87'); // purple-950
      gradient.addColorStop(1, '#09090b'); // zinc-950
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1080, 1920);

      // Ambient glow effects
      ctx.fillStyle = 'rgba(168, 85, 247, 0.1)'; // purple glow
      ctx.beginPath();
      ctx.arc(200, 300, 400, 0, Math.PI * 2);
      ctx.filter = 'blur(120px)';
      ctx.fill();
      ctx.filter = 'none';

      ctx.fillStyle = 'rgba(236, 72, 153, 0.1)'; // pink glow
      ctx.beginPath();
      ctx.arc(880, 1600, 400, 0, Math.PI * 2);
      ctx.filter = 'blur(120px)';
      ctx.fill();
      ctx.filter = 'none';

      // Title
      ctx.textAlign = 'center';
      ctx.font = 'bold 72px Inter, sans-serif';
      const titleGradient = ctx.createLinearGradient(0, 320, 0, 400);
      titleGradient.addColorStop(0, '#fde047'); // yellow-300
      titleGradient.addColorStop(0.5, '#fb923c'); // orange-400
      titleGradient.addColorStop(1, '#ec4899'); // pink-500
      ctx.fillStyle = titleGradient;
      ctx.fillText('THE ACADEMIC', 540, 380);
      ctx.fillText('COMEBACK IS REAL!', 540, 480);

      // Icon/Badge
      ctx.fillStyle = '#a855f7'; // purple-500
      ctx.beginPath();
      ctx.arc(540, 680, 100, 0, Math.PI * 2);
      ctx.fill();
      
      // Sparkles emoji or icon representation
      ctx.font = 'bold 80px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('✨', 540, 720);

      // Tier transition
      ctx.font = 'bold 42px Inter, sans-serif';
      ctx.fillStyle = '#ef4444'; // red-400
      ctx.fillText(TIER_LABELS[oldTier], 300, 900);
      
      ctx.fillStyle = '#71717a'; // zinc-500
      ctx.fillText('➔', 540, 900);
      
      ctx.fillStyle = '#10b981'; // emerald-400
      ctx.fillText(TIER_LABELS[newTier], 780, 900);

      // Stress drop info
      ctx.font = 'bold 48px Inter, sans-serif';
      ctx.fillStyle = '#fafafa'; // zinc-50
      ctx.fillText('Penurunan Tingkat Stress', 540, 1040);
      
      ctx.font = 'bold 96px Inter, sans-serif';
      const dropGradient = ctx.createLinearGradient(0, 1100, 0, 1200);
      dropGradient.addColorStop(0, '#10b981'); // emerald-500
      dropGradient.addColorStop(1, '#14b8a6'); // teal-500
      ctx.fillStyle = dropGradient;
      ctx.fillText(`-${stressDrop} Poin`, 540, 1180);

      // Visual bar chart representation
      const barWidth = 120;
      const maxBarHeight = 300;
      
      // Before bar (red)
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(300, 1450 - maxBarHeight, barWidth, maxBarHeight);
      ctx.fillStyle = '#fecaca';
      ctx.font = 'bold 32px Inter, sans-serif';
      ctx.fillText('Sebelum', 360, 1490);
      
      // After bar (green) - proportionally shorter
      const afterHeight = Math.max(50, maxBarHeight - (stressDrop * 0.03));
      ctx.fillStyle = '#10b981';
      ctx.fillRect(660, 1450 - afterHeight, barWidth, afterHeight);
      ctx.fillStyle = '#86efac';
      ctx.fillText('Sesudah', 720, 1490);

      // Footer/Watermark
      ctx.font = 'bold 36px Inter, sans-serif';
      ctx.fillStyle = '#a1a1aa'; // zinc-400
      ctx.fillText('Project005', 540, 1680);
      
      ctx.font = '28px Inter, sans-serif';
      ctx.fillStyle = '#71717a'; // zinc-500
      ctx.fillText('#AcademicComeback', 540, 1740);

      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });

      // Try Web Share API (mobile) with the image
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], 'academic-comeback.png', { type: 'image/png' });
        const shareData = {
          title: 'Academic Comeback',
          text: `THE ACADEMIC COMEBACK IS REAL! 🚀\n\nSaya baru saja menyelamatkan tugas dari zona Overcooked dan menurunkan tingkat stress sebanyak ${stressDrop} poin!\n\n#Project005 #AcademicComeback`,
          files: [file],
        };
        
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return;
        }
      }

      // Fallback: download button (desktop)
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `academic-comeback-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to share:', err);
      
      // Ultimate fallback: copy text to clipboard
      const text = `THE ACADEMIC COMEBACK IS REAL! 🚀\n\nSaya baru saja menyelamatkan tugas dari zona Overcooked dan menurunkan tingkat stress sebanyak ${stressDrop} poin!\nTier: ${TIER_LABELS[oldTier]} ➔ ${TIER_LABELS[newTier]}\n\n#Project005 #AcademicComeback`;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch (copyErr) {
        console.error('Clipboard fallback failed:', copyErr);
      }
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-md"
          onClick={onClose}
        >
          {/* Sound Toggle Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleSound();
            }}
            className="absolute top-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
          >
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>

          <motion.div
            initial={{ scale: 0.9, y: 15, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 15, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 120 }}
            className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-purple-500/20 bg-gradient-to-b from-purple-950/90 to-zinc-950 p-6 text-center shadow-2xl shadow-purple-500/10 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Ambient Background Glow */}
            <div className="absolute -top-32 -left-32 h-64 w-64 rounded-full bg-purple-500/10 blur-3xl" />
            <div className="absolute -right-32 -bottom-32 h-64 w-64 rounded-full bg-pink-500/10 blur-3xl" />

            {/* Icon */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 shadow-lg shadow-purple-500/25">
              <Sparkles className="h-8 w-8 text-white animate-pulse" />
            </div>

            {/* GSAP Animated Title */}
            <h2
              ref={titleRef}
              className="bg-gradient-to-r from-yellow-300 via-orange-400 to-pink-500 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent sm:text-3xl"
            >
              {/* Text filled dynamically by GSAP */}
            </h2>

            <p className="mt-2 text-sm text-zinc-400">
              Kamu berhasil menyelesaikan tugas dari zona bahaya!
            </p>

            {/* Old Tier -> New Tier Transition */}
            <div className="my-6 flex items-center justify-center gap-3">
              <div
                className={`rounded-xl border px-3 py-1.5 text-xs font-bold uppercase tracking-wider shadow-sm ${
                  TIER_COLORS[oldTier]?.bg
                } ${TIER_COLORS[oldTier]?.text} ${TIER_COLORS[oldTier]?.border}`}
              >
                {TIER_LABELS[oldTier]}
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-650" />
              <div
                className={`rounded-xl border px-3 py-1.5 text-xs font-bold uppercase tracking-wider shadow-sm ${
                  TIER_COLORS[newTier]?.bg
                } ${TIER_COLORS[newTier]?.text} ${TIER_COLORS[newTier]?.border} animate-bounce`}
              >
                {TIER_LABELS[newTier]}
              </div>
            </div>

            {/* Stress Drop Graph (Framer Motion easeOutExpo heights) */}
            <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="mb-3 flex items-center justify-between text-xs font-semibold text-zinc-450">
                <span>Penurunan Tingkat Stress</span>
                <span className="flex items-center gap-1 text-emerald-450">
                  <Flame className="h-3.5 w-3.5" />
                  -{stressDrop} Poin
                </span>
              </div>

              {/* Stress Drop Vertical Bar Chart */}
              <div className="flex h-44 items-end justify-center gap-8 px-4 pb-2">
                {/* Before Bar */}
                <div className="flex flex-col items-center gap-1">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 120 }}
                    transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
                    className="w-12 rounded-t-xl bg-gradient-to-t from-red-650 to-orange-500 shadow-lg shadow-red-500/10"
                  />
                  <span className="text-[10px] font-bold text-zinc-550">Sebelum</span>
                </div>

                {/* After Bar */}
                <div className="flex flex-col items-center gap-1">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: Math.max(25, 120 - stressDrop * 0.02) }} // Scale appropriately for points
                    transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
                    className="w-12 rounded-t-xl bg-gradient-to-t from-emerald-650 to-teal-500 shadow-lg shadow-emerald-500/10"
                  />
                  <span className="text-[10px] font-bold text-zinc-550">Sesudah</span>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleShare}
                className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-650 to-pink-650 text-sm font-semibold text-white transition-all hover:opacity-90"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Kartu Tersimpan!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4" />
                    <span>Share My Comeback</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="flex min-h-[46px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 px-6 text-sm font-semibold text-zinc-350 transition-all hover:bg-zinc-800"
              >
                Lanjutkan! 🚀
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
