import { useEffect, useRef } from "react";
import * as THREE from "three";

const ThreeBackground = () => {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Scene
    const scene = new THREE.Scene();

    // Camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 4;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    // Particles
    const particleCount = 120;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6;
      velocities.push({
        x: (Math.random() - 0.5) * 0.003,
        y: (Math.random() - 0.5) * 0.003,
      });
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0x6366f1,
      size: 0.045,
      transparent: true,
      opacity: 0.7,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    // Floating torus rings
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const torusGeo = new THREE.TorusGeometry(
        1.5 + i * 0.8,
        0.008,
        8,
        80
      );
      const torusMat = new THREE.MeshBasicMaterial({
        color: i === 0 ? 0x6366f1 : i === 1 ? 0x22c55e : 0x06b6d4,
        transparent: true,
        opacity: 0.12,
      });
      const torus = new THREE.Mesh(torusGeo, torusMat);
      torus.rotation.x = Math.random() * Math.PI;
      torus.rotation.y = Math.random() * Math.PI;
      scene.add(torus);
      rings.push(torus);
    }

    // Mouse parallax
    let mouseX = 0;
    let mouseY = 0;
    const handleMouse = (e) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 0.4;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 0.4;
    };
    window.addEventListener("mousemove", handleMouse);

    // Resize
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // Animation loop
    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);

      // Move particles
      const pos = geometry.attributes.position.array;
      for (let i = 0; i < particleCount; i++) {
        pos[i * 3]     += velocities[i].x;
        pos[i * 3 + 1] += velocities[i].y;

        // Wrap around
        if (pos[i * 3] > 6)  pos[i * 3] = -6;
        if (pos[i * 3] < -6) pos[i * 3] = 6;
        if (pos[i * 3 + 1] > 4)  pos[i * 3 + 1] = -4;
        if (pos[i * 3 + 1] < -4) pos[i * 3 + 1] = 4;
      }
      geometry.attributes.position.needsUpdate = true;

      // Rotate rings slowly
      rings.forEach((ring, i) => {
        ring.rotation.x += 0.001 * (i + 1);
        ring.rotation.y += 0.0015 * (i + 1);
      });

      // Parallax camera
      camera.position.x += (mouseX - camera.position.x) * 0.02;
      camera.position.y += (-mouseY - camera.position.y) * 0.02;

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("mousemove", handleMouse);
      window.removeEventListener("resize", handleResize);
      mount.removeChild(renderer.domElement);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
};

export default ThreeBackground;
