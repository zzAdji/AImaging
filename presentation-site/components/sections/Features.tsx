"use client";

import { gsap, ScrollTrigger } from "@/lib/gsap";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    tag: "01 — Classification",
    title: "Identification Neuronale\nde Pathologies",
    description: "Notre ensemble d'architectures — DenseNet-121, ResNet et EfficientNet — effectue une classification multi-label des pathologies thoraciques, avec des scores de confiance haute précision pour chaque observation.",
    bg: "bg-[#0c0c0c]",
    text: "text-white",
    accent: "text-white",
  },
  {
    tag: "02 — Explicabilité",
    title: "Localisation IA\nExplicable",
    description: "Les cartes d'attention Grad-CAM visualisent le point focal du réseau de neurones. Comprenez en profondeur la logique diagnostique grâce à la localisation au niveau du pixel.",
    bg: "bg-[#1a1a1a]",
    text: "text-white",
    accent: "text-white",
  },
  {
    tag: "03 — Segmentation Anatomique",
    title: "Cartographie\nAnatomique Précise",
    description: "Le pipeline CheXmask délimite précisément les structures anatomiques de la radiographie, fournissant un contexte spatial vérifié à chaque prédiction du modèle.",
    bg: "bg-[#0c0c0c]",
    text: "text-white",
    accent: "text-white",
  },
  {
    tag: "04 — Échographie (Bientôt)",
    title: "Analyse Échographique\nIntelligente",
    description: "La prochaine phase d'AImaging : l'analyse échographique assistée par intelligence artificielle, étendant le diagnostic automatisé aux examens échographiques.",
    bg: "bg-[#1a1a1a]",
    text: "text-white",
    accent: "text-white",
  },
];

export default function Features() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    const sections = gsap.utils.toArray<HTMLElement>(".feature-section");

    mm.add("(prefers-reduced-motion: no-preference)", () => {
        sections.forEach((section, i) => {
          const container = section.querySelector(".feature-container");

          if (i > 0) {
            gsap.set(container, { rotation: 30, transformOrigin: "bottom left" });
            gsap.to(container, {
              rotation: 0,
              ease: "none",
              scrollTrigger: {
                trigger: section,
                start: "top bottom",
                end: "top 25%",
                scrub: true,
              },
            });
          }

          if (i < sections.length) {
            ScrollTrigger.create({
              trigger: section,
              start: "bottom bottom",
              end: "bottom top",
              pin: true,
              pinSpacing: false,
            });
          }
        });
    });

    mm.add("(prefers-reduced-motion: reduce)", () => {
        sections.forEach((section) => {
            const container = section.querySelector(".feature-container");
            gsap.set(container, { rotation: 0 });
        });
    });
  }, { scope: containerRef });

  return (
    <div id="features" ref={containerRef} className="relative">
      {FEATURES.map((feature, i) => (
        <section key={i} className="feature-section relative h-screen w-full overflow-hidden">
          <div className={cn(
            "feature-container relative h-full w-full p-6 sm:p-12 md:p-20 flex flex-col justify-center border-t border-white/5",
            feature.bg,
            feature.text
          )}>
            <div className="max-w-7xl mx-auto w-full flex flex-col gap-10 md:gap-24">
                <div className="flex flex-col gap-4 md:gap-6">
                    <p className={cn("font-mono text-[10px] md:text-xs tracking-[0.2em] uppercase opacity-60", feature.accent)}>{feature.tag}</p>
                    <div className="h-px w-full bg-current opacity-20" />
                    <h2 className="font-sans font-bold text-3xl sm:text-5xl md:text-7xl lg:text-9xl leading-[1.3] tracking-tight md:tracking-tighter uppercase break-words">
                        {feature.title.replace('\n', ' ')}
                    </h2>
                </div>

                <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
                    <p className="font-sans text-base sm:text-lg md:text-2xl max-w-2xl opacity-70 leading-relaxed md:leading-normal">
                        {feature.description}
                    </p>
                    <div className="font-mono text-[10px] opacity-40 uppercase tracking-widest hidden md:block shrink-0">
                        AImaging // v1.0.0
                    </div>
                </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
