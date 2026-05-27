import { useEffect, useRef } from "react";

const CustomCursor = () => {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const pos = useRef({ x: 0, y: 0 });
  const ring = useRef({ x: 0, y: 0 });
  const rafRef = useRef(null);

  useEffect(() => {
    const onMove = (e) => {
      pos.current = { x: e.clientX, y: e.clientY };
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
      }
    };

    const loop = () => {
      ring.current.x += (pos.current.x - ring.current.x) * 0.12;
      ring.current.y += (pos.current.y - ring.current.y) * 0.12;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ring.current.x}px, ${ring.current.y}px, 0) translate(-50%, -50%)`;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    const grow = () => {
      if (dotRef.current)  { dotRef.current.style.width = "17px"; dotRef.current.style.height = "17px"; }
      if (ringRef.current) { ringRef.current.style.width = "50px"; ringRef.current.style.height = "50px"; }
    };
    const shrink = () => {
      if (dotRef.current)  { dotRef.current.style.width = "10px"; dotRef.current.style.height = "10px"; }
      if (ringRef.current) { ringRef.current.style.width = "34px"; ringRef.current.style.height = "34px"; }
    };

    document.addEventListener("mousemove", onMove);
    document.querySelectorAll("button, a, .nav-item, .summary-card, .chart-card, .month-row, .filter-btn, select, input").forEach((el) => {
      el.addEventListener("mouseenter", grow);
      el.addEventListener("mouseleave", shrink);
    });

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      document.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="cursor" />
      <div ref={ringRef} className="cursor-ring" />
    </>
  );
};

export default CustomCursor;
