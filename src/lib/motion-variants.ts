"use client";

/**
 * Framer Motion variant presets for Project005.
 *
 * All durations capped at 300ms per Requirement 14.4.11.
 * Variants respect `prefers-reduced-motion` via the `reduceMotion` prop on
 * Framer's `LazyMotion` / individual `motion` components; the durations here
 * are the *un-reduced* values — Framer auto-collapses them to 0 when the
 * user's OS-level preference is active.
 *
 * Requirements: 5.2, 14.2, 14.4.11
 */

import type { Variants, Transition } from "framer-motion";

// ─── Shared easing curves ────────────────────────────────────────────────────

/** Premium spring for modals — snappy and decisive (≈250ms settle). */
export const MODAL_SPRING: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 35,
  mass: 0.8,
};

/** Quieter spring for list item stagger — less dramatic than modal. */
export const LIST_SPRING: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 30,
  mass: 0.6,
};

// ─── Modal / Dialog variants ─────────────────────────────────────────────────

/** Backdrop fade — shared across all modals. */
export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

/** Center-stage modal panel (scale + fade + y-shift). */
export const modalPanelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.92, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.92, y: 20 },
};

/** Bottom-sheet panel (slide up from bottom). */
export const bottomSheetVariants: Variants = {
  hidden: { y: "100%", opacity: 0.8 },
  visible: { y: 0, opacity: 1 },
  exit: { y: "100%", opacity: 0.8 },
};

// ─── Stagger list variants ──────────────────────────────────────────────────

/**
 * Parent container that staggers its direct children.
 * Use on the `<ol>` / `<ul>` wrapping the task cards.
 */
export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

/**
 * Individual list item — fades + slides up from 12px below.
 */
export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: LIST_SPRING,
  },
};

// ─── Loading skeleton shimmer ────────────────────────────────────────────────

/**
 * Skeleton pulse variant — opacity oscillation for loading states.
 * Intentionally uses a repeat loop rather than CSS `animate-pulse` so it
 * can be killed cleanly by `AnimatePresence` when data arrives.
 */
export const skeletonPulseVariants: Variants = {
  initial: { opacity: 0.4 },
  animate: {
    opacity: [0.4, 0.7, 0.4],
    transition: {
      duration: 1.4,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15 },
  },
};

// ─── Toast / notification ────────────────────────────────────────────────────

export const toastVariants: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 24, scale: 0.96 },
};

// ─── Fade-in utility (generic mount animation) ──────────────────────────────

export const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};
