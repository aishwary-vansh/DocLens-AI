// src/pages/landing/BgCanvas.jsx
// Canvas particle network — direct port of the inline JS from test.html
import { useEffect, useRef } from 'react';

const BgCanvas = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, nodes = [];
    const mouse = { x: -2000, y: -2000 };
    let rafId;

    const resize = () => {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };

    const mkNode = () => {
      const doc = Math.random() > 0.62;
      return {
        x:    Math.random() * W,
        y:    Math.random() * H,
        vx:   (Math.random() - 0.5) * 0.22,
        vy:   (Math.random() - 0.5) * 0.22,
        size: doc ? 5.5 : Math.random() * 1.8 + 0.8,
        op:   Math.random() * 0.35 + 0.08,
        doc,
        ph:   Math.random() * Math.PI * 2,
        ps:   Math.random() * 0.012 + 0.004,
      };
    };

    const init = () => {
      resize();
      nodes = [];
      const n = Math.min(85, Math.floor(W * H / 13500));
      for (let i = 0; i < n; i++) nodes.push(mkNode());
    };

    const drawDoc = (n, op) => {
      const w = 9, h = 11, f = 3;
      ctx.beginPath();
      ctx.moveTo(n.x - w / 2, n.y - h / 2);
      ctx.lineTo(n.x + w / 2 - f, n.y - h / 2);
      ctx.lineTo(n.x + w / 2, n.y - h / 2 + f);
      ctx.lineTo(n.x + w / 2, n.y + h / 2);
      ctx.lineTo(n.x - w / 2, n.y + h / 2);
      ctx.closePath();
      ctx.fillStyle = `rgba(222,219,210,${op})`;
      ctx.fill();
    };

    const frame = () => {
      ctx.clearRect(0, 0, W, H);

      // connections
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < 155) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(222,219,210,${(1 - d / 155) * 0.11})`;
            ctx.lineWidth   = 0.5;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        // mouse connections
        const mdx = a.x - mouse.x, mdy = a.y - mouse.y;
        const md  = Math.sqrt(mdx * mdx + mdy * mdy);
        if (md < 190) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(222,219,210,${(1 - md / 190) * 0.22})`;
          ctx.lineWidth   = 0.5;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }

      // nodes
      for (const n of nodes) {
        n.ph += n.ps;
        const op = Math.max(0, n.op + Math.sin(n.ph) * 0.07);
        if (n.doc) {
          drawDoc(n, op);
        } else {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(222,219,210,${op})`;
          ctx.fill();
        }
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20)     n.x = W + 20;
        if (n.x > W + 20)  n.x = -20;
        if (n.y < -20)     n.y = H + 20;
        if (n.y > H + 20)  n.y = -20;
      }

      rafId = requestAnimationFrame(frame);
    };

    const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onResize = () => init();

    window.addEventListener('mousemove', onMove);
    window.addEventListener('resize', onResize);
    init();
    frame();

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="bg-canvas"
      style={{
        position: 'fixed', inset: 0,
        pointerEvents: 'none', zIndex: 0, opacity: 0.55,
      }}
    />
  );
};

export default BgCanvas;
