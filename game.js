/* Neon Pocket Platformer (v3) - Procedural
   - Path-first / chunk-based procedural generation (always solvable-ish by construction)
   - Verticality + jump pads for big climbs
   - Sword attack + flying enemies
   - Desktop: R regenerates the level
*/

(() => {
  "use strict";

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  function isTouchDevice() {
    return (
      ("ontouchstart" in window) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
      (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0)
    );
  }

  // Prevent iOS Safari bounce/scroll
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  // ---------- Canvas ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const BASE_W = 384;
  const BASE_H = 216;
  let viewW = BASE_W, viewH = BASE_H, dpr = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const scale = Math.max(1, Math.floor(Math.min(rect.width / BASE_W, rect.height / BASE_H)));
    viewW = Math.floor(rect.width / scale);
    viewH = Math.floor(rect.height / scale);

    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener("resize", resize, { passive: true });

  // ---------- Assets ----------
  const assets = {
    bg: new Image(),
    env: new Image(),
    sheet: new Image(),
    ready: false,
  };
  assets.bg.src = "assets/blue_background.png";
  assets.env.src = "assets/new_ground_objects.png";
  assets.sheet.src = "assets/platformer_spritesheet.png";

  function waitImages(imgs) {
    return Promise.all(imgs.map(img => new Promise((res, rej) => {
      if (img.complete && img.naturalWidth) return res();
      img.onload = () => res();
      img.onerror = () => rej(new Error("Failed to load image: " + img.src));
    })));
  }

  // ---------- UI ----------
  const titleScreen = document.getElementById("titleScreen");
  const playBtn = document.getElementById("playBtn");
  const hintText = document.getElementById("hintText");
  const hud = document.getElementById("hud");
  const coinPill = document.getElementById("coinPill");
  const statusPill = document.getElementById("statusPill");
  const overlayMsg = document.getElementById("overlayMsg");

  const mobileControls = document.getElementById("mobileControls");
  const btnLeft = document.getElementById("btnLeft");
  const btnRight = document.getElementById("btnRight");
  const btnJump = document.getElementById("btnJump");
  const btnAttack = document.getElementById("btnAttack");

  const touchMode = isTouchDevice();
  hintText.textContent = touchMode
    ? "Touch: ◀ ▶ move, ⚔ attack, ⤒ jump. Jump pads boost you. Flying enemies need slashing. Reach the neon gate."
    : "Keyboard: A/D or ←/→ move • W/Space/↑ jump • J/K/X/Z attack • R regenerate. Jump pads boost you. Flying enemies need slashing.";

  // ---------- Input ----------
  const input = {
    left: false,
    right: false,
    jumpPressed: false,
    jumpHeld: false,
    atkPressed: false,
    atkHeld: false,
    regenPressed: false,
  };

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  function setupMobileControls() {
    mobileControls.classList.remove("hidden");
    mobileControls.setAttribute("aria-hidden", "false");

    const bindHold = (el, key) => {
      const down = (e) => { e.preventDefault(); input[key] = true; };
      const up = (e) => { e.preventDefault(); input[key] = false; };
      el.addEventListener("pointerdown", down, { passive: false });
      el.addEventListener("pointerup", up, { passive: false });
      el.addEventListener("pointercancel", up, { passive: false });
      el.addEventListener("pointerout", (e) => { if (e.pointerType !== "mouse") up(e); }, { passive: false });
    };
    bindHold(btnLeft, "left");
    bindHold(btnRight, "right");

    btnJump.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!input.jumpHeld) input.jumpPressed = true;
      input.jumpHeld = true;
    }, { passive: false });
    btnJump.addEventListener("pointerup", (e) => { e.preventDefault(); input.jumpHeld = false; }, { passive: false });
    btnJump.addEventListener("pointercancel", (e) => { e.preventDefault(); input.jumpHeld = false; }, { passive: false });

    btnAttack.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!input.atkHeld) input.atkPressed = true;
      input.atkHeld = true;
    }, { passive: false });
    btnAttack.addEventListener("pointerup", (e) => { e.preventDefault(); input.atkHeld = false; }, { passive: false });
    btnAttack.addEventListener("pointercancel", (e) => { e.preventDefault(); input.atkHeld = false; }, { passive: false });
  }

  function setupKeyboard() {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (["arrowleft","a"].includes(k)) input.left = true;
      if (["arrowright","d"].includes(k)) input.right = true;

      if (["arrowup","w"," "].includes(k)) {
        if (!input.jumpHeld) input.jumpPressed = true;
        input.jumpHeld = true;
      }

      if (["j","k","x","z"].includes(k)) {
        if (!input.atkHeld) input.atkPressed = true;
        input.atkHeld = true;
      }

      if (k === "r") input.regenPressed = true;
      if (["arrowleft","arrowright","arrowup"," ","j","k","x","z","r"].includes(k)) e.preventDefault();
    }, { passive: false });

    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      if (["arrowleft","a"].includes(k)) input.left = false;
      if (["arrowright","d"].includes(k)) input.right = false;
      if (["arrowup","w"," "].includes(k)) input.jumpHeld = false;
      if (["j","k","x","z"].includes(k)) input.atkHeld = false;
    }, { passive: true });
  }

  // ---------- Sprites ----------
  const SPR = 16;
  const SPRITES = {
    playerIdle: [{ x: 16, y: 0 }, { x: 32, y: 0 }, { x: 48, y: 0 }, { x: 64, y: 0 }],
    playerAttack: [{ x: 0, y: 16 }, { x: 16, y: 16 }],
    enemyGround: [{ x: 160, y: 0 }, { x: 176, y: 0 }, { x: 192, y: 0 }, { x: 208, y: 0 }, { x: 224, y: 0 }],
    enemyFly: [{ x: 80, y: 0 }, { x: 96, y: 0 }, { x: 112, y: 0 }, { x: 128, y: 0 }],
    coin: [{ x: 0, y: 32 }, { x: 16, y: 32 }, { x: 32, y: 32 }, { x: 48, y: 32 }, { x: 64, y: 32 }],
  };

  const ENV = {
    blockA: { sx: 0, sy: 0, sw: 16, sh: 16 },
    blockB: { sx: 16, sy: 0, sw: 16, sh: 16 },
    blockC: { sx: 32, sy: 0, sw: 16, sh: 16 },
    blockD: { sx: 48, sy: 0, sw: 16, sh: 16 },
    blockF: { sx: 16, sy: 16, sw: 16, sh: 16 },
    spikeFull: { sx: 0, sy: 32, sw: 16, sh: 16 },
  };

  // ---------- Capability constraints ----------
  const CAP = {
    tile: 16,
    maxGap: 136,        // safe horizontal gap
    maxStepUp: 64,      // safe vertical step-up
    maxStepDown: 96,    // safe drop
    padBoostVy: -860,   // jump pad vertical speed
  };

  // ---------- Level state ----------
  let level = null;

  function generateLevel(seed) {
    const rng = makeRng(seed);
    const snap = (v) => Math.round(v / CAP.tile) * CAP.tile;

    const staticPlatforms = [];
    const movingPlatforms = [];
    const spikes = [];
    const pads = [];
    const coins = [];
    const enemies = [];

    const minY = 176;
    const maxY = 464;

    const addPlatform = (x, y, w, h=40) => {
      x = snap(x); y = snap(y); w = snap(w);
      w = Math.max(w, CAP.tile * 4);
      staticPlatforms.push({ x, y, w, h });
      return staticPlatforms[staticPlatforms.length - 1];
    };

    const addMovingPlatform = (x, y, w, h, type, opts) => {
      x = snap(x); y = snap(y); w = snap(w);
      const p = Object.assign({ x, y, w, h, type, vx: 0, vy: 0 }, opts);
      movingPlatforms.push(p);
      return p;
    };

    const addSpikeRow = (x, y, tiles) => {
      for (let i = 0; i < tiles; i++) {
        spikes.push({ x: snap(x + i*CAP.tile), y: snap(y), w: 16, h: 16 });
      }
    };

    const addPad = (x, y) => pads.push({ x: snap(x), y: snap(y), w: 16, h: 10 });

    const addCoinLine = (x, y, count, spacing=22) => {
      for (let i = 0; i < count; i++) coins.push({ x: x + i*spacing, y, taken: false });
    };

    const placeGroundEnemy = (p) => {
      if (p.w < 140) return;
      const ex = p.x + 40 + rng() * Math.max(10, p.w - 80);
      enemies.push({
        kind: "ground",
        x: ex, y: 0,
        dir: rng() < 0.5 ? -1 : 1,
        minX: p.x + 10,
        maxX: p.x + p.w - 30,
        alive: true,
        w: 18, h: 18,
        vy: 0, onGround: false,
        animT: rng() * 10,
      });
    };

    const placeFlyEnemy = (nearX, nearY) => {
      const span = 160 + rng()*120;
      const x0 = nearX + 40 + rng()*140;
      const y0 = clamp(nearY - (60 + rng()*80), minY, maxY - 160);
      enemies.push({
        kind: "fly",
        x: x0, y: y0,
        baseX: x0,
        baseY: y0,
        span,
        phase: rng()*Math.PI*2,
        dir: rng() < 0.5 ? -1 : 1,
        alive: true,
        w: 18, h: 18,
        animT: rng()*10,
      });
    };

    // --- Path-first spine ---
    const startY = 420;
    const start = addPlatform(0, startY, 560, 40);
    addCoinLine(180, startY - 44, 3);
    if (rng() < 0.25) placeFlyEnemy(start.x, start.y);

    let cursorX = start.x + start.w;
    let cursorY = startY;

    const CHUNK_W = 320;
    const chunkCount = 9 + Math.floor(rng() * 3); // 9–11

    const pickChunkType = (i) => {
      if (i % 4 === 3) return "rest";
      const r = rng();
      if (r < 0.18) return "towerPad";
      if (r < 0.38) return "spikePitMove";
      if (r < 0.58) return "stairUp";
      if (r < 0.78) return "gapRun";
      return "stairDown";
    };

    for (let i = 0; i < chunkCount; i++) {
      const type = pickChunkType(i);
      const baseX = cursorX;

      // entry landing
      const landing = addPlatform(baseX, cursorY, 120, 40);
      if (rng() < 0.18) addCoinLine(landing.x + 30, landing.y - 44, 2);
      if (rng() < 0.18) placeFlyEnemy(landing.x, landing.y);

      if (type === "rest") {
        const p = addPlatform(baseX, cursorY, CHUNK_W - 20, 40);
        addCoinLine(p.x + 120, p.y - 44, 4);
        if (rng() < 0.35) placeGroundEnemy(p);
        cursorX = p.x + p.w;
      }

      if (type === "stairUp") {
        let x = baseX;
        let y = cursorY;
        const steps = 4 + Math.floor(rng()*2);
        for (let s = 0; s < steps; s++) {
          const dy = -CAP.tile * (1 + (rng() < 0.3 ? 1 : 0));
          y = clamp(snap(y + clamp(dy, -CAP.maxStepUp, CAP.maxStepDown)), minY, maxY);
          const w = 112 + Math.floor(rng()*2)*32;
          const p = addPlatform(x, y, w, 40);
          if (rng() < 0.25) addCoinLine(p.x + 18, p.y - 44, 2);
          if (rng() < 0.22) placeGroundEnemy(p);
          if (rng() < 0.20) placeFlyEnemy(p.x, p.y);
          const gap = Math.min(72 + rng()*64, CAP.maxGap);
          x = p.x + p.w + gap;
        }
        cursorY = y; cursorX = x;
      }

      if (type === "stairDown") {
        let x = baseX;
        let y = cursorY;
        const drops = 3 + Math.floor(rng()*3);
        for (let s = 0; s < drops; s++) {
          const dy = CAP.tile * (1 + (rng() < 0.35 ? 1 : 0));
          y = clamp(snap(y + clamp(dy, -CAP.maxStepUp, CAP.maxStepDown)), minY, maxY);
          const w = 128 + Math.floor(rng()*2)*32;
          const p = addPlatform(x, y, w, 40);
          if (rng() < 0.20) addCoinLine(p.x + 26, p.y - 44, 2);
          if (rng() < 0.18) placeGroundEnemy(p);
          if (rng() < 0.18) placeFlyEnemy(p.x, p.y);
          const gap = Math.min(72 + rng()*64, CAP.maxGap);
          x = p.x + p.w + gap;
        }
        cursorY = y; cursorX = x;
      }

      if (type === "gapRun") {
        let x = baseX;
        let y = cursorY;
        const hops = 5 + Math.floor(rng()*2);
        for (let h = 0; h < hops; h++) {
          const dy = (rng() < 0.5 ? -1 : 1) * CAP.tile * (rng() < 0.6 ? 1 : 2);
          y = clamp(snap(y + clamp(dy, -CAP.maxStepUp, CAP.maxStepDown)), minY, maxY);
          const w = 80 + Math.floor(rng()*3)*16;
          const p = addPlatform(x, y, w, 40);

          // spikes only ON TOP (never inside ground)
          if (rng() < 0.12) addSpikeRow(p.x + p.w - 32, p.y - 16, 2);

          if (rng() < 0.28) addCoinLine(p.x + 18, p.y - 44, 2);
          if (rng() < 0.22) placeFlyEnemy(p.x, p.y);

          const gap = Math.min(80 + rng()*56, CAP.maxGap);
          x = p.x + p.w + gap;
        }
        cursorY = y; cursorX = x;
      }

      if (type === "spikePitMove") {
        const pitW = 320 + Math.floor(rng()*3)*64;
        const pitX = baseX;
        const floorY = clamp(snap(cursorY), minY, maxY);

        const approach = addPlatform(pitX, floorY, 180, 40);
        if (rng() < 0.25) placeGroundEnemy(approach);

        // spikes placed clearly BELOW the walk line
        const spikeY = floorY + 56;
        addSpikeRow(pitX + 180, spikeY, Math.floor((pitW - 220)/16));

        addMovingPlatform(pitX + 220, floorY - 96, 120, 20, "h", {
          minX: pitX + 220,
          maxX: pitX + pitW - 240,
          speed: 100 + rng()*40,
          dir: rng() < 0.5 ? -1 : 1
        });

        if (rng() < 0.55) {
          addMovingPlatform(pitX + pitW - 240, floorY - 140, 96, 20, "v", {
            minY: floorY - 180,
            maxY: floorY - 60,
            speed: 70 + rng()*25,
            dir: -1
          });
        }

        const exit = addPlatform(pitX + pitW - 40, floorY - 32, 240, 40);
        if (rng() < 0.35) placeFlyEnemy(exit.x, exit.y);

        cursorY = exit.y; cursorX = exit.x + exit.w;
      }

      if (type === "towerPad") {
        const base = addPlatform(baseX, cursorY, 240, 40);
        addPad(base.x + base.w/2, base.y - 10);

        const highY = clamp(snap(cursorY - (CAP.tile * (7 + Math.floor(rng()*4)))), minY, maxY);
        const high = addPlatform(base.x + 180, highY, 240, 40);

        const midY = snap((base.y + high.y) / 2);
        addPlatform(base.x + 110, midY, 160, 40);

        addCoinLine(high.x + 40, high.y - 44, 5);
        if (rng() < 0.35) placeFlyEnemy(high.x, high.y);
        if (rng() < 0.25) placeGroundEnemy(high);

        const exit = addPlatform(high.x + high.w + 64, clamp(snap(high.y + (rng() < 0.5 ? 32 : 0)), minY, maxY), 220, 40);
        cursorY = exit.y; cursorX = exit.x + exit.w;
      }

      // chunk filler
      if (cursorX - baseX < CHUNK_W - 60) {
        const extraW = (CHUNK_W - (cursorX - baseX)) - 20;
        const extra = addPlatform(cursorX, cursorY, extraW, 40);
        if (rng() < 0.20) addCoinLine(extra.x + 34, extra.y - 44, 2);
        if (rng() < 0.16) placeGroundEnemy(extra);
        cursorX = extra.x + extra.w;
      }
    }

    // Finish + goal
    const endRun = addPlatform(cursorX, cursorY, 460, 40);
    addCoinLine(endRun.x + 140, endRun.y - 44, 4);

    const ledge1 = addPlatform(endRun.x + endRun.w - 260, clamp(endRun.y - 80, minY, maxY), 160, 40);
    const ledge2 = addPlatform(endRun.x + endRun.w - 120, clamp(endRun.y - 128, minY, maxY), 160, 40);
    addCoinLine(ledge2.x + 30, ledge2.y - 44, 3);

    const goal = { x: endRun.x + endRun.w - 70, y: ledge2.y - 64, w: 32, h: 64 };
    const width = goal.x + 260;

    return {
      seed,
      width,
      height: 600,
      gravity: 1400,
      frictionGround: 0.86,
      frictionAir: 0.94,
      playerStart: { x: 80, y: 260 },
      goal,
      staticPlatforms,
      movingPlatforms,
      spikes,
      pads,
      coins,
      enemies,
    };
  }

  // ---------- Player ----------
  const player = {
    x: 0, y: 0,
    w: 18, h: 22,
    vx: 0, vy: 0,
    onGround: false,
    groundRef: null,
    coyote: 0,
    coyoteMax: 0.10,
    face: 1,
    animT: 0,
    coins: 0,
    atkT: 0,
    atkDur: 0.16,
    atkCD: 0,
    atkCDMax: 0.22,
    padLock: 0,
  };

  const cam = { x: 0, y: 0 };

  // ---------- Collision ----------
  const aabb = (ax, ay, aw, ah, bx, by, bw, bh) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  const getAllPlatforms = () => [...level.staticPlatforms, ...level.movingPlatforms];

  function resolveCollisions(ent, platforms, dt) {
    ent.onGround = false;
    ent.groundRef = null;

    ent.x += ent.vx * dt;
    for (const p of platforms) {
      if (aabb(ent.x, ent.y, ent.w, ent.h, p.x, p.y, p.w, p.h)) {
        if (ent.vx > 0) ent.x = p.x - ent.w;
        else if (ent.vx < 0) ent.x = p.x + p.w;
        ent.vx = 0;
      }
    }

    ent.y += ent.vy * dt;
    for (const p of platforms) {
      if (aabb(ent.x, ent.y, ent.w, ent.h, p.x, p.y, p.w, p.h)) {
        if (ent.vy > 0) {
          ent.y = p.y - ent.h;
          ent.vy = 0;
          ent.onGround = true;
          ent.groundRef = p;
        } else if (ent.vy < 0) {
          ent.y = p.y + p.h;
          ent.vy = 0;
        }
      }
    }
  }

  // ---------- Loop ----------
  let running = false;
  let last = 0;

  function applyLevel(lv) {
    level = lv;
    statusPill.textContent = `Seed ${String(level.seed).slice(0, 6)}`;
    resetState();
  }

  function resetState() {
    player.x = level.playerStart.x;
    player.y = level.playerStart.y;
    player.vx = 0; player.vy = 0;
    player.onGround = false;
    player.groundRef = null;
    player.coyote = 0;
    player.face = 1;
    player.animT = 0;
    player.coins = 0;
    player.atkT = 0;
    player.atkCD = 0;
    player.padLock = 0;

    for (const c of level.coins) c.taken = false;
    for (const e of level.enemies) e.alive = true;

    coinPill.textContent = "💠 0";
    overlayMsg.classList.add("hidden");
  }

  function regenLevel() {
    const seed = ((Date.now() + Math.random()*1e9) >>> 0);
    applyLevel(generateLevel(seed));
  }

  function stopOverlay(msg) {
    overlayMsg.textContent = msg + (touchMode ? "\nTap to replay." : "\nClick to replay. (R regenerates)");
    overlayMsg.classList.remove("hidden");
    running = false;

    const restart = () => {
      overlayMsg.removeEventListener("pointerdown", restart);
      overlayMsg.classList.add("hidden");
      resetState();
      running = true;
      last = performance.now();
      requestAnimationFrame(tick);
    };
    overlayMsg.addEventListener("pointerdown", restart, { passive: true });
  }

  function startGame() {
    titleScreen.classList.add("hidden");
    hud.classList.remove("hidden");

    if (touchMode) setupMobileControls();
    else setupKeyboard();

    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    applyLevel(generateLevel(seed));

    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  }
  playBtn.addEventListener("click", startGame, { passive: true });

  function updateMovingPlatforms(dt) {
    for (const p of level.movingPlatforms) {
      p.vx = 0; p.vy = 0;
      if (p.type === "h") {
        p.vx = p.dir * p.speed;
        p.x += p.vx * dt;
        if (p.x < p.minX) { p.x = p.minX; p.dir = 1; }
        if (p.x > p.maxX) { p.x = p.maxX; p.dir = -1; }
      } else if (p.type === "v") {
        p.vy = p.dir * p.speed;
        p.y += p.vy * dt;
        if (p.y < p.minY) { p.y = p.minY; p.dir = 1; }
        if (p.y > p.maxY) { p.y = p.maxY; p.dir = -1; }
      }
    }
  }

  function tick(now) {
    if (!running) return;

    let dt = (now - last) / 1000;
    last = now;
    dt = clamp(dt, 0, 1/20);

    update(dt);
    render();

    input.jumpPressed = false;
    input.atkPressed = false;
    input.regenPressed = false;

    requestAnimationFrame(tick);
  }

  function update(dt) {
    if (!level) return;

    if (input.regenPressed) regenLevel();

    if (player.padLock > 0) player.padLock = Math.max(0, player.padLock - dt);

    updateMovingPlatforms(dt);

    // sword timers
    if (player.atkCD > 0) player.atkCD = Math.max(0, player.atkCD - dt);
    if (player.atkT > 0) player.atkT = Math.max(0, player.atkT - dt);

    if (input.atkPressed && player.atkCD <= 0) {
      player.atkT = player.atkDur;
      player.atkCD = player.atkCDMax;
    }

    // movement
    const accel = player.onGround ? 1150 : 820;
    const maxSpeed = player.atkT > 0 ? 200 : 220;

    if (input.left && !input.right) { player.vx -= accel * dt; player.face = -1; }
    else if (input.right && !input.left) { player.vx += accel * dt; player.face = 1; }
    else {
      player.vx *= player.onGround ? level.frictionGround : level.frictionAir;
      if (Math.abs(player.vx) < 8) player.vx = 0;
    }
    player.vx = clamp(player.vx, -maxSpeed, maxSpeed);

    // gravity + coyote
    player.vy += level.gravity * dt;
    if (player.onGround) player.coyote = player.coyoteMax;
    else player.coyote = Math.max(0, player.coyote - dt);

    // jump
    const wantJump = input.jumpPressed && (player.onGround || player.coyote > 0);
    if (wantJump) {
      player.vy = -520;
      player.onGround = false;
      player.coyote = 0;
    }
    if (!input.jumpHeld && player.vy < -180) player.vy = -180;

    const platforms = getAllPlatforms();
    resolveCollisions(player, platforms, dt);

    // carry platforms
    if (player.onGround && player.groundRef) {
      const g = player.groundRef;
      if (g.vx) player.x += g.vx * dt;
      if (g.vy) player.y += g.vy * dt;
    }

    // pads
    if (player.padLock <= 0 && player.onGround) {
      const footX = player.x + player.w/2;
      const footY = player.y + player.h;
      for (const pad of level.pads) {
        if (
          footX > pad.x - 10 && footX < pad.x + pad.w + 10 &&
          Math.abs(footY - (pad.y + pad.h)) < 8
        ) {
          player.vy = CAP.padBoostVy;
          player.onGround = false;
          player.coyote = 0;
          player.padLock = 0.25;
          break;
        }
      }
    }

    // fall death
    if (player.y > level.height + 220) { stopOverlay("You fell off the world!"); return; }

    // spikes
    for (const s of level.spikes) {
      if (aabb(player.x, player.y, player.w, player.h, s.x, s.y, s.w, s.h)) {
        stopOverlay("Spikes!"); return;
      }
    }

    // coins
    for (const c of level.coins) {
      if (c.taken) continue;
      if (aabb(player.x, player.y, player.w, player.h, c.x, c.y, 12, 12)) {
        c.taken = true;
        player.coins++;
        coinPill.textContent = `💠 ${player.coins}`;
      }
    }

    // enemies
    for (const e of level.enemies) {
      if (!e.alive) continue;

      if (e.kind === "ground") {
        e.vy += level.gravity * dt;
        const speed = 70;
        const vx = e.dir * speed;
        e.x += vx * dt;

        const tmpVX = e.vx;
        e.vx = vx;
        resolveCollisions(e, platforms, dt);
        e.vx = tmpVX;

        if (e.x < e.minX) { e.x = e.minX; e.dir = 1; }
        if (e.x > e.maxX) { e.x = e.maxX; e.dir = -1; }

        e.animT += dt;
      } else {
        e.animT += dt;
        const t = (performance.now()/1000) + e.phase;
        e.x = e.baseX + Math.sin(t * 0.6) * (e.span/2);
        e.y = e.baseY + Math.sin(t * 2.2) * 8;
      }

      if (aabb(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
        const playerFalling = player.vy > 120;
        const playerAbove = (player.y + player.h) - e.y < 10;
        if (e.kind === "ground" && playerFalling && playerAbove) {
          e.alive = false;
          player.vy = -330;
        } else if (player.atkT > 0) {
          e.alive = false;
        } else {
          stopOverlay("Enemy got you!");
          return;
        }
      }
    }

    // sword hitbox
    if (player.atkT > 0) {
      const reach = 26;
      const hx = player.face > 0 ? (player.x + player.w) : (player.x - reach);
      const hy = player.y + 4;
      const hw = reach;
      const hh = 14;
      for (const e of level.enemies) {
        if (!e.alive) continue;
        if (aabb(hx, hy, hw, hh, e.x, e.y, e.w, e.h)) e.alive = false;
      }
    }

    // goal
    if (aabb(player.x, player.y, player.w, player.h, level.goal.x, level.goal.y, level.goal.w, level.goal.h)) {
      stopOverlay(`Level clear! 💠 ${player.coins}`);
      return;
    }

    // camera
    const targetX = player.x + player.w/2 - viewW/2;
    cam.x = clamp(lerp(cam.x, targetX, 0.12), 0, Math.max(0, level.width - viewW));
    cam.y = 0;

    player.animT += dt;
  }

  // ---------- Render ----------
  function drawTiledBackground() {
    const img = assets.bg;
    const tile = 32;
    const startX = Math.floor(cam.x / tile) * tile;
    for (let y = 0; y < viewH + tile; y += tile) {
      for (let x = startX; x < cam.x + viewW + tile; x += tile) {
        ctx.drawImage(img, 0, 0, 32, 32, Math.floor(x - cam.x), y, tile, tile);
      }
    }
  }

  function drawTile(img, src, dx, dy, dw=16, dh=16) {
    ctx.drawImage(img, src.sx, src.sy, src.sw, src.sh, Math.floor(dx), Math.floor(dy), dw, dh);
  }

  function drawGround(p) {
    const img = assets.env;
    const tile = 16;
    const topTiles = [ENV.blockA, ENV.blockB, ENV.blockC, ENV.blockD];

    for (let x = 0; x < p.w; x += tile) {
      const t = topTiles[Math.floor((p.x + x) / 64) % topTiles.length];
      drawTile(img, t, p.x + x - cam.x, p.y - cam.y, tile, tile);
    }
    for (let y = tile; y < p.h; y += tile) {
      for (let x = 0; x < p.w; x += tile) {
        drawTile(img, ENV.blockF, p.x + x - cam.x, p.y + y - cam.y, tile, tile);
      }
    }
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(Math.floor(p.x - cam.x), Math.floor(p.y - cam.y + 1), Math.floor(p.w), 2);
  }

  function drawMovingPlatform(p) {
    drawGround(p);
    ctx.strokeStyle = "rgba(140, 200, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.floor(p.x - cam.x) + 1, Math.floor(p.y - cam.y) + 1, Math.floor(p.w) - 2, Math.floor(p.h) - 2);
  }

  function drawSpriteFrame(img, frame, x, y, w, h, flipX) {
    ctx.save();
    if (flipX) {
      ctx.translate(Math.floor(x + w), Math.floor(y));
      ctx.scale(-1, 1);
      ctx.drawImage(img, frame.x, frame.y, SPR, SPR, 0, 0, w, h);
    } else {
      ctx.drawImage(img, frame.x, frame.y, SPR, SPR, Math.floor(x), Math.floor(y), w, h);
    }
    ctx.restore();
  }

  function render() {
    if (!level) return;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, viewW, viewH);

    drawTiledBackground();

    ctx.fillStyle = "rgba(20, 50, 110, 0.08)";
    for (let i = 0; i < 6; i++) {
      const y = 24 + i * 26 + Math.sin((performance.now()/1000) * 0.6 + i) * 3;
      ctx.fillRect(0, y, viewW, 8);
    }

    for (const p of level.staticPlatforms) drawGround(p);
    for (const p of level.movingPlatforms) drawMovingPlatform(p);

    for (const s of level.spikes) {
      drawTile(assets.env, ENV.spikeFull, s.x - cam.x, s.y - cam.y, 16, 16);
    }

    // pads
    for (const pad of level.pads) {
      const x = Math.floor(pad.x - cam.x);
      const y = Math.floor(pad.y - cam.y);
      ctx.fillStyle = "rgba(120, 210, 255, 0.18)";
      ctx.fillRect(x - 4, y - 2, 24, 12);
      ctx.strokeStyle = "rgba(120, 210, 255, 0.7)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 4, y - 2, 24, 12);
    }

    // goal
    const gx = Math.floor(level.goal.x - cam.x);
    const gy = Math.floor(level.goal.y - cam.y);
    ctx.fillStyle = "rgba(210, 240, 255, 0.14)";
    ctx.fillRect(gx, gy, level.goal.w, level.goal.h);
    ctx.strokeStyle = "rgba(140, 200, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(gx + 1, gy + 1, level.goal.w - 2, level.goal.h - 2);
    ctx.fillStyle = "rgba(140, 200, 255, 0.22)";
    ctx.fillRect(gx + 6, gy + 6, level.goal.w - 12, level.goal.h - 12);

    // coins
    for (const c of level.coins) {
      if (c.taken) continue;
      const t = performance.now() / 1000;
      const bob = Math.sin(t * 6 + c.x * 0.02) * 2;
      const frame = SPRITES.coin[Math.floor((t * 8) % SPRITES.coin.length)];
      drawSpriteFrame(assets.sheet, frame, c.x - cam.x, c.y - cam.y + bob, 14, 14, false);
    }

    // enemies
    for (const e of level.enemies) {
      if (!e.alive) continue;
      const t = e.animT + (performance.now()/1000);
      const frames = (e.kind === "fly") ? SPRITES.enemyFly : SPRITES.enemyGround;
      const frame = frames[Math.floor((t * 8) % frames.length)];
      drawSpriteFrame(assets.sheet, frame, e.x - cam.x, e.y - cam.y, 20, 20, e.dir < 0);
    }

    // player
    const pt = player.animT;
    const moving = Math.abs(player.vx) > 15;
    let pFrame = SPRITES.playerIdle[Math.floor((pt * (moving ? 10 : 6)) % SPRITES.playerIdle.length)];
    if (player.atkT > 0) {
      const idx = Math.floor(((player.atkDur - player.atkT) / player.atkDur) * SPRITES.playerAttack.length);
      pFrame = SPRITES.playerAttack[clamp(idx, 0, SPRITES.playerAttack.length - 1)];
    }
    drawSpriteFrame(assets.sheet, pFrame, player.x - cam.x, player.y - cam.y, 22, 22, player.face < 0);

    // slash fx
    if (player.atkT > 0) {
      const prog = (player.atkDur - player.atkT) / player.atkDur;
      const sx = player.face > 0 ? (player.x + 12) : (player.x - 14);
      const sy = player.y + 4;
      const fx = 0, fy = 48;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.translate(Math.floor(sx - cam.x), Math.floor(sy - cam.y));
      if (player.face < 0) ctx.scale(-1, 1);
      ctx.rotate((-0.8 + prog * 1.6) * 0.35);
      ctx.drawImage(assets.sheet, fx, fy, SPR, SPR, 0, 0, 24, 24);
      ctx.restore();
    }

    const grd = ctx.createRadialGradient(viewW/2, viewH/2, 40, viewW/2, viewH/2, Math.max(viewW, viewH));
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  // ---------- Boot ----------
  async function boot() {
    resize();
    try {
      await waitImages([assets.bg, assets.env, assets.sheet]);
      assets.ready = true;
    } catch (err) {
      titleScreen.querySelector("h1").textContent = "Failed to load assets";
      hintText.textContent = String(err);
      return;
    }
  }

  boot();
})();
