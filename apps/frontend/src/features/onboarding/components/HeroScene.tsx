import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import cooperativeRings from "../assets/cooperative-rings.png";

export function HeroScene() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [visible, setVisible] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const motion = !paused && !reduced && visible;
  const scene = import.meta.env.VITE_SPLINE_SCENE_URL as string | undefined;

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(preference.matches);
    preference.addEventListener("change", change);
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting));
    if (host.current) observer.observe(host.current);
    return () => {
      preference.removeEventListener("change", change);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    const element = host.current;
    if (!motion || !element) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        element.style.setProperty("--pointer-x", `${(event.clientX - rect.left - rect.width / 2) / 35}px`);
        element.style.setProperty("--pointer-y", `${(event.clientY - rect.top - rect.height / 2) / 35}px`);
      });
    };
    const reset = () => {
      element.style.setProperty("--pointer-x", "0px");
      element.style.setProperty("--pointer-y", "0px");
    };
    element.addEventListener("pointermove", move, { passive: true });
    element.addEventListener("pointerleave", reset);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", reset);
      reset();
    };
  }, [motion]);
  useEffect(() => {
    if (!scene || !motion || !canvas.current) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setLoaded(false);
    const target = canvas.current;
    void import("@splinetool/runtime")
      .then(async ({ Application }) => {
        if (cancelled) return;
        const app = new Application(target, { renderMode: "auto" });
        dispose = () => app.dispose();
        await app.load(scene);
        if (!cancelled) setLoaded(true);
        else app.dispose();
      })
      .catch(() => {
        if (!cancelled) setLoaded(false);
        dispose?.();
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [scene, motion]);
  return (
    <div ref={host} className='hero-scene' data-motion={motion}>
      <div className='hero-art' aria-hidden='true'>
        <img
          className='hero-art-image'
          src={cooperativeRings}
          width='1254'
          height='1254'
          alt=''
          loading='eager'
        />
        {scene && motion ? (
          <canvas ref={canvas} className='spline-canvas' style={{ opacity: loaded ? 1 : 0 }} />
        ) : null}
      </div>
      {!reduced ? (
        <Button
          className='motion-control'
          size='icon'
          variant='outline'
          onClick={() => setPaused(!paused)}
          aria-label={paused ? "Putar animasi" : "Jeda animasi"}
          aria-pressed={paused}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
      ) : null}
    </div>
  );
}
