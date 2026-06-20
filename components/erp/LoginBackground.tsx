"use client";

import { useEffect, useRef } from "react";

/**
 * Premium 3D background for the login screen: floating metallic bike parts
 * (procedurally generated) with red/white studio lighting, env reflections and
 * gentle parallax. Lazy-loads three.js so it never blocks the login form.
 * Falls back to the CSS gradient when WebGL is unavailable or reduced-motion.
 */
export default function LoginBackground() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let disposed = false;
    let raf = 0;
    let cleanup = () => {};

    (async () => {
      // WebGL support check — otherwise leave the CSS gradient as fallback
      try {
        const c = document.createElement("canvas");
        if (!(c.getContext("webgl2") || c.getContext("webgl"))) return;
      } catch {
        return;
      }

      const THREE: any = await import("three");
      let RoomEnvironment: any = null;
      try {
        ({ RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js"));
      } catch {
        /* reflections will fall back to lights only */
      }
      if (disposed) return;

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const isMobile = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;

      const W = () => host.clientWidth || window.innerWidth;
      const H = () => host.clientHeight || window.innerHeight;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
      renderer.setSize(W(), H());
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      host.appendChild(renderer.domElement);
      Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block" });

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, W() / H(), 0.1, 100);
      camera.position.set(0, 0, 15);

      // studio reflections for believable metal
      if (RoomEnvironment) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        try {
          scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        } catch {
          /* ignore */
        }
      }

      // lighting — white key + red accent + cool fill
      scene.add(new THREE.AmbientLight(0xffffff, 0.45));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(6, 9, 8);
      scene.add(key);
      const red = new THREE.DirectionalLight(0xd11f2d, 2.0);
      red.position.set(-8, -3, 5);
      scene.add(red);
      const fill = new THREE.DirectionalLight(0xbfe0ff, 0.7);
      fill.position.set(-4, 6, -6);
      scene.add(fill);

      // shared materials (reused for performance)
      const matSilver = new THREE.MeshStandardMaterial({ color: 0xc7ccd2, metalness: 1, roughness: 0.3 });
      const matSteel = new THREE.MeshStandardMaterial({ color: 0x7c828a, metalness: 1, roughness: 0.45 });
      const matRed = new THREE.MeshStandardMaterial({ color: 0xc81f2d, metalness: 0.7, roughness: 0.32 });
      const mats = [matSilver, matSilver, matSteel, matRed]; // mostly silver, some red/steel

      // ---- procedural geometry builders ----
      const ex = (shape: any, depth: number, bevel = 0.06) =>
        new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24 }).center();

      function gearGeo(teeth: number, outer: number, root: number, hole: number, depth: number) {
        const s = new THREE.Shape();
        const step = (Math.PI * 2) / teeth;
        for (let i = 0; i < teeth; i++) {
          const a = i * step;
          const p = (r: number, ang: number): [number, number] => [Math.cos(ang) * r, Math.sin(ang) * r];
          if (i === 0) s.moveTo(...p(root, a));
          else s.lineTo(...p(root, a));
          s.lineTo(...p(outer, a + step * 0.22));
          s.lineTo(...p(outer, a + step * 0.42));
          s.lineTo(...p(root, a + step * 0.64));
        }
        s.closePath();
        const h = new THREE.Path();
        h.absarc(0, 0, hole, 0, Math.PI * 2, true);
        s.holes.push(h);
        return ex(s, depth);
      }

      function discGeo(outer: number, bore: number, holes: number, holeR: number, depth: number) {
        const s = new THREE.Shape();
        s.absarc(0, 0, outer, 0, Math.PI * 2, false);
        const bh = new THREE.Path();
        bh.absarc(0, 0, bore, 0, Math.PI * 2, true);
        s.holes.push(bh);
        const ring = outer * 0.66;
        for (let i = 0; i < holes; i++) {
          const a = (i / holes) * Math.PI * 2;
          const hp = new THREE.Path();
          hp.absarc(Math.cos(a) * ring, Math.sin(a) * ring, holeR, 0, Math.PI * 2, true);
          s.holes.push(hp);
        }
        return ex(s, depth, 0.03);
      }

      function nutGeo(r: number, hole: number, depth: number) {
        const s = new THREE.Shape();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
        }
        s.closePath();
        const h = new THREE.Path();
        h.absarc(0, 0, hole, 0, Math.PI * 2, true);
        s.holes.push(h);
        return ex(s, depth, 0.04);
      }

      const cyl = (rt: number, rb: number, h: number, seg = 24) => new THREE.CylinderGeometry(rt, rb, h, seg);

      function boltMesh(m: any) {
        const g = new THREE.Group();
        const head = new THREE.Mesh(cyl(0.5, 0.5, 0.35, 6), m);
        head.rotation.x = Math.PI / 2;
        const shaft = new THREE.Mesh(cyl(0.22, 0.22, 1.5, 16), m);
        shaft.rotation.x = Math.PI / 2;
        shaft.position.z = -0.9;
        g.add(head, shaft);
        return g;
      }

      function pistonMesh(m: any) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(cyl(0.6, 0.6, 1.1, 28), m);
        const crown = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
        crown.position.y = 0.55;
        const pin = new THREE.Mesh(cyl(0.14, 0.14, 1.4, 16), matSteel);
        pin.rotation.z = Math.PI / 2;
        pin.position.y = -0.1;
        g.add(body, crown, pin);
        return g;
      }

      function rimMesh(m: any) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.16, 16, 48), m));
        const hub = new THREE.Mesh(cyl(0.32, 0.32, 0.3, 20), m);
        hub.rotation.x = Math.PI / 2;
        g.add(hub);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const spoke = new THREE.Mesh(cyl(0.05, 0.05, 1.34, 8), matSteel);
          spoke.position.set(Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0);
          spoke.rotation.z = a + Math.PI / 2;
          g.add(spoke);
        }
        return g;
      }

      const geos = {
        gear: gearGeo(14, 1.5, 1.18, 0.5, 0.45),
        sprocket: gearGeo(22, 1.6, 1.4, 0.85, 0.22),
        disc: discGeo(1.6, 0.45, 7, 0.14, 0.12),
        nut: nutGeo(0.7, 0.42, 0.4),
      };

      type Builder = () => any;
      const builders: Builder[] = [
        () => new THREE.Mesh(geos.gear, pick(mats)),
        () => new THREE.Mesh(geos.sprocket, pick(mats)),
        () => new THREE.Mesh(geos.disc, pick(mats)),
        () => new THREE.Mesh(geos.nut, pick(mats)),
        () => boltMesh(pick(mats)),
        () => pistonMesh(pick(mats)),
        () => rimMesh(pick(mats)),
      ];
      function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

      const COUNT = isMobile ? 12 : 22;
      const group = new THREE.Group();
      scene.add(group);
      const parts: any[] = [];
      for (let i = 0; i < COUNT; i++) {
        const obj = builders[i % builders.length]();
        const z = -10 + Math.random() * 16; // depth spread
        obj.position.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 14, z);
        const s = 0.5 + Math.random() * 1.1;
        obj.scale.setScalar(s);
        obj.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        obj.userData = {
          spin: new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.2),
          amp: 0.25 + Math.random() * 0.5,
          speed: 0.2 + Math.random() * 0.4,
          phase: Math.random() * Math.PI * 2,
          baseY: obj.position.y,
        };
        group.add(obj);
        parts.push(obj);
      }

      const clock = new THREE.Clock();
      const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
      const onMove = (e: MouseEvent) => {
        mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
        mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      window.addEventListener("mousemove", onMove);

      const onResize = () => {
        camera.aspect = W() / H();
        camera.updateProjectionMatrix();
        renderer.setSize(W(), H());
      };
      window.addEventListener("resize", onResize);

      function renderFrame() {
        const t = clock.elapsedTime;
        for (const p of parts) {
          p.rotation.x += p.userData.spin.x * 0.016;
          p.rotation.y += p.userData.spin.y * 0.016;
          p.rotation.z += p.userData.spin.z * 0.016;
          p.position.y = p.userData.baseY + Math.sin(t * p.userData.speed + p.userData.phase) * p.userData.amp;
        }
        // parallax: mouse + gentle auto-sway
        mouse.x += (mouse.tx - mouse.x) * 0.04;
        mouse.y += (mouse.ty - mouse.y) * 0.04;
        camera.position.x = mouse.x * 1.6 + Math.sin(t * 0.1) * 0.7;
        camera.position.y = -mouse.y * 1.1 + Math.cos(t * 0.08) * 0.4;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      }

      let running = true;
      const loop = () => {
        if (!running) return;
        clock.getDelta();
        renderFrame();
        raf = requestAnimationFrame(loop);
      };

      const onVis = () => {
        if (document.hidden) { running = false; cancelAnimationFrame(raf); }
        else if (!reduceMotion) { running = true; clock.start(); loop(); }
      };
      document.addEventListener("visibilitychange", onVis);

      if (reduceMotion) {
        // static "3D image" fallback — one rendered frame, no loop
        renderFrame();
      } else {
        loop();
      }

      cleanup = () => {
        running = false;
        cancelAnimationFrame(raf);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("resize", onResize);
        document.removeEventListener("visibilitychange", onVis);
        scene.traverse((o: any) => {
          if (o.geometry) o.geometry.dispose?.();
        });
        [matSilver, matSteel, matRed].forEach((m) => m.dispose());
        Object.values(geos).forEach((g: any) => g.dispose?.());
        renderer.dispose();
        if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return <div ref={ref} aria-hidden className="absolute inset-0" />;
}
