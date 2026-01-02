/* Neon Pocket Platformer (v2)
   Improvements:
   - Better-looking level flow (varied heights + pacing)
   - Moving platforms + spike hazards (spikes never embedded in ground)
   - Sword attack (keyboard + mobile button) with attack frame + hitbox
*/

(() => {
  "use strict";

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function isTouchDevice() {
    return (
      ("ontouchstart" in window) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
      (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0)
    );
  }

  // Prevent iOS Safari bounce/scroll
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  // ---------- Canvas setup ----------
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
  const overlayMsg = document.getElementById("overlayMsg");

  const mobileControls = document.getElementById("mobileControls");
  const btnLeft = document.getElementById("btnLeft");
  const btnRight = document.getElementById("btnRight");
  const btnJump = document.getElementById("btnJump");
  const btnAttack = document.getElementById("btnAttack");

  const touchMode = isTouchDevice();
  hintText.textContent = touchMode
    ? "Touch: ◀ ▶ move, ⚔ attack, ⤒ jump. Stomp or slash enemies. Avoid spikes. Reach the neon gate."
    : "Keyboard: A/D or ←/→ move • W/Space/↑ jump • J / K / X attack. Stomp or slash enemies. Avoid spikes. Reach the neon gate.";

  // ---------- Input ----------
  const input = {
    left: false,
    right: false,

    jumpPressed: false,   // edge
    jumpHeld: false,
    jumpBuffer: 0,
    jumpBufferMax: 0.12,

    atkPressed: false,    // edge
    atkHeld: false,
    atkBuffer: 0,
    atkBufferMax: 0.10,
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
      el.addEventListener("pointerout", (e) => {
        if (e.pointerType !== "mouse") up(e);
      }, { passive: false });
    };

    bindHold(btnLeft, "left");
    bindHold(btnRight, "right");

    const downJump = (e) => {
      e.preventDefault();
      input.jumpHeld = true;
      input.jumpPressed = true;
      input.jumpBuffer = input.jumpBufferMax;
    };
    const upJump = (e) => { e.preventDefault(); input.jumpHeld = false; };

    btnJump.addEventListener("pointerdown", downJump, { passive: false });
    btnJump.addEventListener("pointerup", upJump, { passive: false });
    btnJump.addEventListener("pointercancel", upJump, { passive: false });

    const downAtk = (e) => {
      e.preventDefault();
      if (!input.atkHeld) {
        input.atkPressed = true;
        input.atkBuffer = input.atkBufferMax;
      }
      input.atkHeld = true;
    };
    const upAtk = (e) => { e.preventDefault(); input.atkHeld = false; };

    btnAttack.addEventListener("pointerdown", downAtk, { passive: false });
    btnAttack.addEventListener("pointerup", upAtk, { passive: false });
    btnAttack.addEventListener("pointercancel", upAtk, { passive: false });
  }

  function setupKeyboard() {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();

      if (["arrowleft","a"].includes(k)) input.left = true;
      if (["arrowright","d"].includes(k)) input.right = true;

      if (["arrowup","w"," "].includes(k)) {
        if (!input.jumpHeld) {
          input.jumpPressed = true;
          input.jumpBuffer = input.jumpBufferMax;
        }
        input.jumpHeld = true;
      }

      if (["j","k","x","z"].includes(k)) {
        if (!input.atkHeld) {
          input.atkPressed = true;
          input.atkBuffer = input.atkBufferMax;
        }
        input.atkHeld = true;
      }

      if (["arrowleft","arrowright","arrowup"," ","j","k","x","z"].includes(k)) e.preventDefault();
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
    playerIdle: [
      { x: 16, y: 0 }, { x: 32, y: 0 }, { x: 48, y: 0 }, { x: 64, y: 0 }
    ],
    playerAttack: [
      { x: 0, y: 16 }, { x: 16, y: 16 }
    ],
    enemyIdle: [
      { x: 160, y: 0 }, { x: 176, y: 0 }, { x: 192, y: 0 }, { x: 208, y: 0 }, { x: 224, y: 0 }
    ],
    coin: [{ x: 0, y: 32 }, { x: 16, y: 32 }, { x: 32, y: 32 }, { x: 48, y: 32 }, { x: 64, y: 32 }],
  };

  // Environment sheet (64x64)
  const ENV = {
    blockA: { sx: 0, sy: 0, sw: 16, sh: 16 },
    blockB: { sx: 16, sy: 0, sw: 16, sh: 16 },
    blockC: { sx: 32, sy: 0, sw: 16, sh: 16 },
    blockD: { sx: 48, sy: 0, sw: 16, sh: 16 },
    blockF: { sx: 16, sy: 16, sw: 16, sh: 16 },
    spikeFull: { sx: 0, sy: 32, sw: 16, sh: 16 },
  };

  // ---------- Level ----------
  const LEVEL = {
    width: 2600,
    height: 600,
    gravity: 1400,
    frictionGround: 0.86,
    frictionAir: 0.94,
    player: { x: 80, y: 120 },
    goal: { x: 2470, y: 220, w: 32, h: 64 },

    staticPlatforms: [
      { x: 0,   y: 420, w: 520, h: 40 },
      { x: 540, y: 420, w: 240, h: 40 },

      { x: 820, y: 400, w: 180, h: 40 },
      { x: 1030,y: 360, w: 180, h: 40 },
      { x: 1240,y: 320, w: 200, h: 40 },

      { x: 1500,y: 420, w: 360, h: 40 },

      { x: 2060,y: 420, w: 540, h: 40 },

      { x: 2140,y: 320, w: 140, h: 24 },
      { x: 2320,y: 280, w: 160, h: 24 },
      { x: 2460,y: 240, w: 120, h: 24 },
    ],

    movingPlatforms: [
      { x: 1660, y: 320, w: 120, h: 20, type: "h", minX: 1600, maxX: 1880, speed: 90, dir: 1, vx: 0, vy: 0 },
      { x: 1880, y: 360, w: 96,  h: 20, type: "v", minY: 260, maxY: 380, speed: 70, dir: -1, vx: 0, vy: 0 },
    ],

    spikes: [
      ...Array.from({ length: 34 }, (_, i) => ({ x: 1520 + i*16, y: 404, w: 16, h: 16 })),
      { x: 1064, y: 344, w: 16, h: 16 },
      { x: 1100, y: 344, w: 16, h: 16 },
    ],

    coins: [
      { x: 210, y: 380, taken: false },
      { x: 250, y: 380, taken: false },
      { x: 290, y: 380, taken: false },

      { x: 860, y: 360, taken: false },
      { x: 900, y: 360, taken: false },
      { x: 1090, y: 320, taken: false },
      { x: 1290, y: 280, taken: false },
      { x: 1330, y: 280, taken: false },

      { x: 1700, y: 280, taken: false },
      { x: 1740, y: 280, taken: false },
      { x: 1780, y: 280, taken: false },
      { x: 1920, y: 240, taken: false },

      { x: 2360, y: 240, taken: false },
      { x: 2400, y: 240, taken: false },
    ],

    enemies: [
      { x: 420, y: 0, dir: 1, minX: 220, maxX: 720, alive: true },
      { x: 940, y: 0, dir: -1, minX: 820, maxX: 1180, alive: true },
      { x: 2240, y: 0, dir: 1, minX: 2100, maxX: 2540, alive: true },
    ]
  };

  // ---------- Entities ----------
  const player = {
    x: LEVEL.player.x, y: LEVEL.player.y,
    w: 18, h: 22,
    vx: 0, vy: 0,
    onGround: false,
    groundRef: null,

    coyote: 0,
    coyoteMax: 0.10,

    face: 1,
    animT: 0,

    coins: 0,
    dead: false,

    atkT: 0,
    atkDur: 0.16,
    atkCD: 0,
    atkCDMax: 0.22,
  };

  const enemyProto = () => ({
    w: 18, h: 18,
    vy: 0,
    onGround: false,
    animT: 0,
  });
  const enemies = LEVEL.enemies.map(e => Object.assign(enemyProto(), e));

  const cam = { x: 0, y: 0 };

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function getAllPlatforms() {
    return [...LEVEL.staticPlatforms, ...LEVEL.movingPlatforms];
  }

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

  // ---------- Game loop ----------
  let running = false;
  let last = 0;
  let dt = 0;

  function resetLevel() {
    player.x = LEVEL.player.x;
    player.y = LEVEL.player.y;
    player.vx = 0; player.vy = 0;
    player.onGround = false;
    player.groundRef = null;
    player.coyote = 0;
    player.face = 1;
    player.animT = 0;
    player.dead = false;
    player.coins = 0;
    player.atkT = 0;
    player.atkCD = 0;

    for (const c of LEVEL.coins) c.taken = false;

    for (let i = 0; i < enemies.length; i++) {
      enemies[i].x = LEVEL.enemies[i].x;
      enemies[i].y = 0;
      enemies[i].dir = LEVEL.enemies[i].dir;
      enemies[i].alive = true;
      enemies[i].vy = 0;
      enemies[i].onGround = false;
      enemies[i].animT = 0;
    }

    for (const p of LEVEL.movingPlatforms) {
      p.vx = 0; p.vy = 0;
      if (p.type === "h") p.dir = 1;
      if (p.type === "v") p.dir = -1;
    }

    coinPill.textContent = "💠 0";
    overlayMsg.classList.add("hidden");
  }

  function startGame() {
    titleScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    if (touchMode) setupMobileControls();
    else setupKeyboard();

    resetLevel();
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  }
  playBtn.addEventListener("click", startGame, { passive: true });

  function stopWithOverlay(msg) {
    overlayMsg.textContent = msg;
    overlayMsg.classList.remove("hidden");
    running = false;

    const restart = () => {
      overlayMsg.removeEventListener("pointerdown", restart);
      overlayMsg.classList.add("hidden");
      resetLevel();
      running = true;
      last = performance.now();
      requestAnimationFrame(tick);
    };
    overlayMsg.addEventListener("pointerdown", restart, { passive: true });
  }

  function tick(now) {
    if (!running) return;

    dt = (now - last) / 1000;
    last = now;
    dt = clamp(dt, 0, 1/20);

    update(dt);
    render();

    input.jumpPressed = false;
    input.atkPressed = false;

    requestAnimationFrame(tick);
  }

  function updateMovingPlatforms(dt) {
    for (const p of LEVEL.movingPlatforms) {
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

  function killPlayer(reason) {
    stopWithOverlay(reason || "You died! Tap/Click to retry.");
  }

  function winLevel() {
    stopWithOverlay(`Level clear! 💠 ${player.coins}\nTap/Click to replay.`);
  }

  function update(dtLocal) {
    if (input.jumpBuffer > 0) input.jumpBuffer = Math.max(0, input.jumpBuffer - dtLocal);
    if (input.atkBuffer > 0) input.atkBuffer = Math.max(0, input.atkBuffer - dtLocal);

    updateMovingPlatforms(dtLocal);

    if (player.atkCD > 0) player.atkCD = Math.max(0, player.atkCD - dtLocal);
    if (player.atkT > 0) player.atkT = Math.max(0, player.atkT - dtLocal);

    if ((input.atkPressed || input.atkBuffer > 0) && player.atkCD <= 0) {
      player.atkT = player.atkDur;
      player.atkCD = player.atkCDMax;
      input.atkBuffer = 0;
    }

    const accel = player.onGround ? 1150 : 820;
    const maxSpeed = player.atkT > 0 ? 200 : 220;

    if (input.left && !input.right) {
      player.vx -= accel * dtLocal;
      player.face = -1;
    } else if (input.right && !input.left) {
      player.vx += accel * dtLocal;
      player.face = 1;
    } else {
      player.vx *= player.onGround ? LEVEL.frictionGround : LEVEL.frictionAir;
      if (Math.abs(player.vx) < 8) player.vx = 0;
    }
    player.vx = clamp(player.vx, -maxSpeed, maxSpeed);

    player.vy += LEVEL.gravity * dtLocal;
    if (player.onGround) player.coyote = player.coyoteMax;
    else player.coyote = Math.max(0, player.coyote - dtLocal);

    const wantJump = (input.jumpPressed || input.jumpBuffer > 0) && (player.onGround || player.coyote > 0);
    if (wantJump) {
      player.vy = -520;
      player.onGround = false;
      player.coyote = 0;
      input.jumpBuffer = 0;
    }
    if (!input.jumpHeld && player.vy < -180) player.vy = -180;

    const platforms = getAllPlatforms();
    resolveCollisions(player, platforms, dtLocal);

    if (player.onGround && player.groundRef) {
      const g = player.groundRef;
      if (g.vx) player.x += g.vx * dtLocal;
      if (g.vy) player.y += g.vy * dtLocal;
    }

    if (player.y > LEVEL.height + 220) {
      killPlayer("You fell off the world!\nTap/Click to retry.");
      return;
    }

    for (const s of LEVEL.spikes) {
      if (aabb(player.x, player.y, player.w, player.h, s.x, s.y, s.w, s.h)) {
        killPlayer("Spikes! Tap/Click to retry.");
        return;
      }
    }

    for (const c of LEVEL.coins) {
      if (c.taken) continue;
      if (aabb(player.x, player.y, player.w, player.h, c.x, c.y, 12, 12)) {
        c.taken = true;
        player.coins += 1;
        coinPill.textContent = `💠 ${player.coins}`;
      }
    }

    for (const e of enemies) {
      if (!e.alive) continue;

      e.vy += LEVEL.gravity * dtLocal;
      const speed = 70;
      const vx = e.dir * speed;

      e.x += vx * dtLocal;

      const oldVX = e.vx;
      e.vx = vx;
      resolveCollisions(e, platforms, dtLocal);
      e.vx = oldVX;

      if (e.x < e.minX) { e.x = e.minX; e.dir = 1; }
      if (e.x > e.maxX) { e.x = e.maxX; e.dir = -1; }

      for (const s of LEVEL.spikes) {
        if (aabb(e.x, e.y, e.w, e.h, s.x, s.y, s.w, s.h)) {
          e.alive = false;
          break;
        }
      }

      if (!e.alive) continue;
      if (aabb(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
        const playerFalling = player.vy > 120;
        const playerAbove = (player.y + player.h) - e.y < 10;
        if (playerFalling && playerAbove) {
          e.alive = false;
          player.vy = -330;
        } else if (player.atkT > 0) {
          e.alive = false;
        } else {
          killPlayer("Ouch! Enemy got you.\nTap/Click to retry.");
          return;
        }
      }
    }

    if (player.atkT > 0) {
      const reach = 26;
      const hx = player.face > 0 ? (player.x + player.w) : (player.x - reach);
      const hy = player.y + 4;
      const hw = reach;
      const hh = 14;

      for (const e of enemies) {
        if (!e.alive) continue;
        if (aabb(hx, hy, hw, hh, e.x, e.y, e.w, e.h)) {
          e.alive = false;
        }
      }
    }

    if (aabb(player.x, player.y, player.w, player.h, LEVEL.goal.x, LEVEL.goal.y, LEVEL.goal.w, LEVEL.goal.h)) {
      winLevel();
      return;
    }

    const targetX = player.x + player.w/2 - viewW/2;
    cam.x = clamp(lerp(cam.x, targetX, 0.12), 0, LEVEL.width - viewW);
    cam.y = 0;

    player.animT += dtLocal;
    for (const e of enemies) e.animT += dtLocal;
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
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, viewW, viewH);

    drawTiledBackground();

    ctx.fillStyle = "rgba(20, 50, 110, 0.08)";
    for (let i = 0; i < 6; i++) {
      const y = 24 + i * 26 + Math.sin((performance.now()/1000) * 0.6 + i) * 3;
      ctx.fillRect(0, y, viewW, 8);
    }

    for (const p of LEVEL.staticPlatforms) drawGround(p);
    for (const p of LEVEL.movingPlatforms) drawMovingPlatform(p);

    const env = assets.env;
    for (const s of LEVEL.spikes) {
      drawTile(env, ENV.spikeFull, s.x - cam.x, s.y - cam.y, 16, 16);
    }

    const gx = Math.floor(LEVEL.goal.x - cam.x);
    const gy = Math.floor(LEVEL.goal.y - cam.y);
    ctx.fillStyle = "rgba(210, 240, 255, 0.14)";
    ctx.fillRect(gx, gy, LEVEL.goal.w, LEVEL.goal.h);
    ctx.strokeStyle = "rgba(140, 200, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(gx + 1, gy + 1, LEVEL.goal.w - 2, LEVEL.goal.h - 2);
    ctx.fillStyle = "rgba(140, 200, 255, 0.22)";
    ctx.fillRect(gx + 6, gy + 6, LEVEL.goal.w - 12, LEVEL.goal.h - 12);

    const sheet = assets.sheet;
    for (const c of LEVEL.coins) {
      if (c.taken) continue;
      const t = performance.now() / 1000;
      const bob = Math.sin(t * 6 + c.x * 0.02) * 2;
      const frame = SPRITES.coin[Math.floor((t * 8) % SPRITES.coin.length)];
      drawSpriteFrame(sheet, frame, c.x - cam.x, c.y - cam.y + bob, 14, 14, false);
    }

    for (const e of enemies) {
      if (!e.alive) continue;
      const t = e.animT;
      const frame = SPRITES.enemyIdle[Math.floor((t * 8) % SPRITES.enemyIdle.length)];
      drawSpriteFrame(sheet, frame, e.x - cam.x, e.y - cam.y, 20, 20, e.dir < 0);
    }

    const pt = player.animT;
    const moving = Math.abs(player.vx) > 15;
    let pFrame = SPRITES.playerIdle[Math.floor((pt * (moving ? 10 : 6)) % SPRITES.playerIdle.length)];
    if (player.atkT > 0) {
      const idx = Math.floor(((player.atkDur - player.atkT) / player.atkDur) * SPRITES.playerAttack.length);
      pFrame = SPRITES.playerAttack[clamp(idx, 0, SPRITES.playerAttack.length - 1)];
    }
    drawSpriteFrame(sheet, pFrame, player.x - cam.x, player.y - cam.y, 22, 22, player.face < 0);

    if (player.atkT > 0) {
      const prog = (player.atkDur - player.atkT) / player.atkDur;
      const sx = player.face > 0 ? (player.x + 12) : (player.x - 14);
      const sy = player.y + 4;

      const fx = 0;
      const fy = 48;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.translate(Math.floor(sx - cam.x), Math.floor(sy - cam.y));
      if (player.face < 0) ctx.scale(-1, 1);
      ctx.rotate((-0.8 + prog * 1.6) * 0.35);
      ctx.drawImage(sheet, fx, fy, SPR, SPR, 0, 0, 24, 24);
      ctx.restore();
    }

    const grd = ctx.createRadialGradient(viewW/2, viewH/2, 40, viewW/2, viewH/2, Math.max(viewW, viewH));
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,viewW,viewH);
  }

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

  (async function main() {
    await boot();
  })();
})();

