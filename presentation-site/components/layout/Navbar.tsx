"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { cn } from "@/lib/utils";
import { usePageTransition } from "./PageTransition";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const pathname = usePathname();
  // Delay navbar reveal on home page to sync with cinematic hero animation
  const [isIntroDone, setIsIntroDone] = useState(pathname !== "/");
  const navRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const { navigateTo } = usePageTransition();

  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      // Update scrolled state
      if (currentScrollY > 50) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }

      // Hide navbar on scroll down, show on scroll up
      if (currentScrollY > 100) {
        if (currentScrollY > lastScrollY.current) {
          setIsHidden(true);
        } else {
          setIsHidden(false);
        }
      } else {
        setIsHidden(false);
      }

      lastScrollY.current = currentScrollY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Handle intro delay for home page
  useEffect(() => {
    if (pathname === "/") {
      setIsIntroDone(false);
      const timer = setTimeout(() => {
        setIsIntroDone(true);
      }, 2500); // 2.5s delay to match Hero's text reveal
      return () => clearTimeout(timer);
    } else {
      setIsIntroDone(true);
    }
  }, [pathname]);

  useGSAP(() => {
    if (!isIntroDone || isHidden) {
      gsap.to(outerRef.current, {
        y: -100,
        opacity: 0,
        duration: 0.5,
        ease: "power3.inOut",
        overwrite: "auto",
      });
    } else {
      gsap.to(outerRef.current, {
        y: 0,
        opacity: 1,
        duration: 0.8, // Slightly longer smooth drop
        ease: "power3.out",
        overwrite: "auto",
      });
    }
  }, [isHidden, isIntroDone]);

  useGSAP(() => {
    if (scrolled) {
      gsap.to(navRef.current, {
        y: 20,
        backgroundColor: "rgba(16, 16, 16, 0.6)",
        backdropFilter: "blur(16px)",
        padding: "0.5rem 1.5rem",
        borderRadius: "9999px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        duration: 0.4,
        ease: "power2.out",
        overwrite: "auto",
      });
    } else {
      gsap.to(navRef.current, {
        y: 0,
        backgroundColor: "rgba(16, 16, 16, 0)",
        backdropFilter: "blur(0px)",
        padding: "1.5rem 2rem",
        borderRadius: "0px",
        border: "1px solid rgba(255, 255, 255, 0)",
        duration: 0.4,
        ease: "power2.out",
        overwrite: "auto",
      });
    }
  }, [scrolled]);

  const navLinks = [{ label: "Performance", href: "/performance" }];

  const openApp = () => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:5173";
    window.open(appUrl, "_blank");
  };

  return (
    <div
      ref={outerRef}
      className="fixed top-0 inset-x-0 z-[100] flex justify-center pointer-events-none will-change-transform"
      style={{
        opacity: pathname === "/" && !isIntroDone ? 0 : undefined,
        transform: pathname === "/" && !isIntroDone ? "translateY(-100px)" : undefined,
      }}
    >
      <nav
        ref={navRef}
        className="flex items-center gap-4 md:gap-8 pointer-events-auto will-change-transform"
      >
        <button
          onClick={() => navigateTo("/")}
          className="shrink-0 hover:opacity-80 transition-opacity"
          aria-label="AImaging"
        >
          <Image
            src="/images/logo.png"
            alt="AImaging"
            width={670}
            height={118}
            priority
            className="h-5 w-auto md:h-6"
          />
        </button>

        <div className="flex items-center gap-3 md:gap-6">
          {navLinks.map((link) => (
            <button
              key={link.href}
              onClick={() => navigateTo(link.href)}
              className="text-[11px] md:text-[10px] font-mono uppercase tracking-widest text-white hover:text-accent transition-colors whitespace-nowrap"
            >
              {link.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          <button
            onClick={openApp}
            className="flex items-center justify-center whitespace-nowrap px-4 md:px-6 py-2 bg-accent text-white/70 rounded-full text-[8px] md:text-[10px] font-bold tracking-widest uppercase hover:bg-accent/80 transition-colors pl-[1.1rem] md:pl-[1.6rem]"
          >
            Interface
          </button>
        </div>
      </nav>
    </div>
  );
}
