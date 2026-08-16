import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Loader2, Pause, Play, X } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ThreeDResult } from "../../lib/examinations";
import { cn } from "../../lib/cn";

/* ------------------------------ Vues rotatives ------------------------------ */

function FramesView({ frames }: { frames: ThreeDResult["frames"] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % frames.length), 220);
    return () => window.clearInterval(timer);
  }, [playing, frames.length]);

  const frame = frames[index];
  if (!frame) return <p className="p-4 text-[12px] text-ink-3">Aucune vue rendue.</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-black/40">
        <img
          src={frame.data_url}
          alt={`Vue ${frame.angle}°`}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
        <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] tabular-nums text-white/90">
          {frame.angle}° · {index + 1}/{frames.length}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPlaying((v) => !v)}
          title={playing ? "Pause" : "Rotation automatique"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
        >
          {playing ? <Pause size={14} strokeWidth={2.2} /> : <Play size={14} strokeWidth={2.2} />}
        </button>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
          {frames.map((f, i) => (
            <button
              key={f.angle}
              type="button"
              onClick={() => { setIndex(i); setPlaying(false); }}
              title={`Vue ${f.angle}°`}
              className={cn(
                "h-12 w-12 shrink-0 overflow-hidden rounded-md border transition-colors duration-150 ease-out",
                i === index ? "border-accent" : "border-border opacity-70 hover:opacity-100",
              )}
            >
              <img src={f.data_url} alt={`${f.angle}°`} className="h-full w-full object-cover" draggable={false} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Volume interactif ------------------------------ */

function sliceTexture(data: Uint8Array, size: number, axis: "x" | "y" | "z", position: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = ctx.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i;
      const v = j;
      const x = axis === "x" ? position : u;
      const y = axis === "y" ? position : v;
      const z = axis === "z" ? position : axis === "x" ? j : u;
      const value = data[((z * size + y) * size + x)] ?? 0;
      const offset = (j * size + i) * 4;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function VolumeCanvas({ result }: { result: ThreeDResult }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const volume = result.volume;
  const [axisX, setAxisX] = useState(0.5);
  const [axisY, setAxisY] = useState(0.5);
  const [axisZ, setAxisZ] = useState(0.5);

  const data = useMemo(() => {
    if (!volume) return null;
    const binary = atob(volume.data_b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }, [volume]);

  useEffect(() => {
    if (!data || !volume || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    const side = volume.nx * volume.spacing;
    camera.position.set(side * 1.2, side * 0.9, side * 1.2);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.6;
    controls.enableDamping = true;
    controls.update();

    const geometry = new THREE.PlaneGeometry(side, side);
    const planeX = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, side: THREE.DoubleSide }));
    const planeY = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, side: THREE.DoubleSide }));
    planeY.rotation.y = Math.PI / 2;
    const planeZ = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, side: THREE.DoubleSide }));
    planeZ.rotation.x = -Math.PI / 2;
    scene.add(planeX, planeY, planeZ);

    const updatePlanes = () => {
      const px = (axisX - 0.5) * side;
      const py = (axisY - 0.5) * side;
      const pz = (axisZ - 0.5) * side;
      planeX.position.set(0, 0, pz);
      (planeX.material as THREE.MeshBasicMaterial).map = tex("z", axisZ);
      planeY.position.set(px, 0, 0);
      (planeY.material as THREE.MeshBasicMaterial).map = tex("x", axisX);
      planeZ.position.set(0, py, 0);
      (planeZ.material as THREE.MeshBasicMaterial).map = tex("y", axisY);
    };
    let disposed = false;
    const tex = (axis: "x" | "y" | "z", position: number) => {
      const canvas = sliceTexture(data, volume.nx, axis, Math.round(position * (volume.nx - 1)));
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      return texture;
    };
    updatePlanes();

    let frameId = 0;
    const animate = () => {
      if (disposed) return;
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      geometry.dispose();
      planeX.material.dispose();
      planeY.material.dispose();
      planeZ.material.dispose();
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    };
  }, [data, volume, axisX, axisY, axisZ]);

  if (!volume || !data) return <p className="p-4 text-[12px] text-ink-3">Volume indisponible.</p>;

  const slider = (label: string, value: number, setter: (v: number) => void) => (
    <label className="flex items-center gap-2 text-[10.5px] text-ink-3">
      <span className="w-4 text-center">{label}</span>
      <input
        type="range" min={0} max={100} value={Math.round(value * 100)}
        onChange={(e) => setter(Number(e.target.value) / 100)}
        className="w-24 accent-accent"
      />
    </label>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3" data-attr="ai-volume-interactive">
      <div ref={containerRef} className="min-h-[220px] flex-1 overflow-hidden rounded-lg border border-border bg-black/40" />
      <div className="flex flex-wrap items-center gap-3">
        {slider("X", axisX, setAxisX)}
        {slider("Y", axisY, setAxisY)}
        {slider("Z", axisZ, setAxisZ)}
        <span className="text-[10.5px] text-ink-4">Glisser pour orbiter · molette pour zoomer</span>
      </div>
    </div>
  );
}

/* ------------------------------ Panneau principal ------------------------------ */

export function VolumeViewer({
  result,
  onClose,
}: {
  result: ThreeDResult;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"frames" | "volume">(result.volume ? "frames" : "frames");

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-[2px]" data-attr="ai-volume-viewer">
      <div className="flex h-[82vh] w-[min(960px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Boxes size={14} strokeWidth={2} className="text-accent" />
          <span className="text-[12.5px] font-semibold text-ink">Reconstruction 3D</span>
          <span className="text-[10.5px] text-ink-4">
            {result.device} · {Math.round(result.elapsedSec / 60)} min · {result.generatedAt.slice(11, 16)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTab("frames")}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] transition-colors duration-150 ease-out",
                tab === "frames" ? "bg-accent/15 text-accent" : "text-ink-3 hover:bg-hover hover:text-ink",
              )}
            >
              Vues rotatives
            </button>
            {result.volume && (
              <button
                type="button"
                onClick={() => setTab("volume")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] transition-colors duration-150 ease-out",
                  tab === "volume" ? "bg-accent/15 text-accent" : "text-ink-3 hover:bg-hover hover:text-ink",
                )}
              >
                Volume interactif
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Fermer"
              className="ml-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
            >
              <X size={13} strokeWidth={2.2} />
            </button>
          </div>
        </div>
        {tab === "frames" && <FramesView frames={result.frames} />}
        {tab === "volume" && result.volume && <VolumeCanvas result={result} />}
      </div>
    </div>
  );
}

/** Bannière compacte affichée pendant la reconstruction côté serveur. */
export function ThreeDBusyBanner({ progress }: { progress: { fraction: number; message: string } | null }) {
  const fraction = progress ? Math.round(progress.fraction * 100) : 0;
  return (
    <div className="flex min-w-[280px] items-center gap-2 rounded-lg border border-accent/30 bg-panel px-3 py-2 text-[11px] text-accent shadow-lg shadow-black/30">
      <Loader2 size={13} strokeWidth={2.2} className="animate-spin" />
      <span className="whitespace-nowrap">{progress?.message ?? "Reconstruction 3D en cours…"}</span>
      <span className="ml-auto tabular-nums text-accent/80">{fraction}%</span>
    </div>
  );
}