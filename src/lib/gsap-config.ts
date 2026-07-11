"use client";

/**
 * GSAP Configuration & Plugin Registration
 * 
 * Centralized GSAP setup for Project005. Registers all required plugins
 * and provides reusable animation utilities.
 * 
 * Requirements: 14.2, 14.6
 */

import gsap from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";

// Register GSAP plugins (client-side only)
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollToPlugin);
}

/**
 * Smooth scroll to a specific element within a container.
 * 
 * @param container - The scrollable container element
 * @param target - The target element to scroll to
 * @param duration - Animation duration in seconds (default: 0.8)
 */
export function smoothScrollTo(
  container: HTMLElement,
  target: HTMLElement,
  duration: number = 0.8,
): void {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const scrollTop = container.scrollTop;
  const targetPosition = scrollTop + targetRect.top - containerRect.top;

  gsap.to(container, {
    scrollTop: targetPosition - 16, // 16px offset for visual breathing room
    duration,
    ease: "power2.inOut",
  });
}

/**
 * Card hover animation configuration.
 * Creates a subtle scale + shadow lift effect on hover.
 */
export const cardHoverConfig = {
  scale: 1.02,
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
  duration: 0.25,
  ease: "power2.out",
};

/**
 * Card hover reset configuration.
 */
export const cardHoverResetConfig = {
  scale: 1,
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
  duration: 0.25,
  ease: "power2.out",
};

/**
 * Page transition fade-in configuration.
 */
export const pageTransitionConfig = {
  from: {
    opacity: 0,
    y: 16,
  },
  to: {
    opacity: 1,
    y: 0,
    duration: 0.5,
    ease: "power2.out",
    stagger: 0.08, // Stagger children animations
  },
};

export default gsap;
