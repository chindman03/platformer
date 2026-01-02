/* Neon Pocket Platformer
   - Canvas + pixel art scaling
   - Auto-detect touch vs keyboard
   - Simple physics + AABB collisions
   - 1 level with platforms, coins, and patrolling enemies
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

  // Render size (in game pixels) scales to device
  const BASE_W = 384; // good for mobile portrait/landscape
  const BASE_H = 216; // 16:9-ish
  let viewW = BASE_W, viewH = BASE_H, dpr = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    // Keep game pixels consistent by choosing an integer scale
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

  const touchMode = isTouchDevice();
  hintText.textContent = touchMode
    ? "Touch controls: ◀ ▶ to move, ⤒ to jump. Goal: reach the neon gate (right side)."
    : "Keyboard: A/D or ←/→ to move, W/Space/↑ to jump. Goal: reach the neon gate (right side).";

  // ---------- Input ----------
  const input = {
    left: false,
    right: false,
    jumpPressed: false,   // edge
    jumpHeld: false,
    jumpBuffer: 0,
    jumpBufferMax: 0.12,  // seconds
  };

  function setBtnHeld(btn, key, held) {
    input[key] = held;
  }

  function setupMobileControls() {
    mobileControls.classList.remove("hidden");
    mobileControls.setAttribute("aria-hidden", "false");

    const bindHold = (el, key) => {
      const down = (e) => { e.preventDefault(); setBtnHeld(el, key, true); };
      const up = (e) => { e.preventDefault(); setBtnHeld(el, key, false); };

      el.addEventListener("pointerdown", down, { passive: false });
      el.addEventListener("pointerup", up, { passive: false });
      el.addEventListener("pointercancel", up, { passive: false });
      el.addEventListener("pointerout", (e) => {
        // when finger drifts off button, keep held only if pointer is still down on element.
        // simplest: release
        if (e.pointerType !== "mouse") up(e);
      }, { passive: false });
    };

    bindHold(btnLeft, "left");
    bindHold(btnRight, "right");

    const downJump = (e) => { e.preventDefault(); input.jumpHeld = true; input.jumpPressed = true; input.jumpBuffer = input.jumpBufferMax; };
    const upJump = (e) => { e.preventDefault(); input.jumpHeld = false; };

    btnJump.addEventListener("pointerdown", downJump, { passive: false });
    btnJump.addEventListener("pointerup", upJump, { passive: false });
    btnJump.addEventListener("pointercancel", upJump, { passive: false });
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
      // prevent page scrolling with arrows/space
      if (["arrowleft","arrowright","arrowup"," "].includes(k)) e.preventDefault();
    }, { passive: false });

    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      if (["arrowleft","a"].includes(k)) input.left = false;
      if (["arrowright","d"].includes(k)) input.right = false;
      if (["arrowup","w"," "].includes(k)) input.jumpHeld = false;
    }, { passive: true });
  }

  // ---------- Sprites ----------
  // The sheet has sprites packed near the top-left.
  // We use 16x16 frames and scale them up when drawing.
  const SPR = 16;

  const SPRITES = {
    playerIdle: [
      { x: 16, y: 0 }, { x: 32, y: 0 }, { x: 48, y: 0 }, { x: 64, y: 0 }
    ],
    playerAttack: [{ x: 0, y: 16 }], // larger-ish, still 16x16, looks like sword swing
    enemyIdle: [
      { x: 160, y: 0 }, { x: 176, y: 0 }, { x: 192, y: 0 }, { x: 208, y: 0 }, { x: 224, y: 0 }
    ],
    coin: [{ x: 0, y: 32 }, { x: 16, y: 32 }, { x: 32, y: 32 }, { x: 48, y: 32 }, { x: 64, y: 32 }],
  };

  // Environment sheet (new_ground_objects.png)
  // We'll use these source rects:
  const ENV = {
    block: { sx: 0, sy: 0, sw: 16, sh: 16 },         // top-left small block
    block2: { sx: 0, sy: 16, sw: 16, sh: 16 },        // below it
    platform: { sx: 16, sy: 0, sw: 48, sh: 32 },      // big platform
    rock1: { sx: 0, sy: 32, sw: 32, sh: 16 },
  };

  // ---------- World / Level ----------
  const LEVEL = {
    width: 2200,
    height: 600,
    gravity: 1400,
    frictionGround: 0.86,
    frictionAir: 0.94,
    player: { x: 80, y: 80 },
    goal: { x: 2060, y: 312, w: 32, h: 64 },
    platforms: [
      // floor segments
      { x: 0, y: 380, w: 700, h: 40 },
      { x: 760, y: 420, w: 600, h: 40 },
      { x: 1440, y: 380, w: 760, h: 40 },

      // floating
      { x: 220, y: 300, w: 160, h: 20 },
      { x: 520, y: 260, w: 160, h: 20 },
      { x: 880, y: 320, w: 140, h: 20 },
      { x: 1120, y: 280, w: 160, h: 20 },
      { x: 1560, y: 300, w: 180, h: 20 },
      { x: 1820, y: 260, w: 160, h: 20 },
    ],
    coins: [
      { x: 250, y: 260, taken: false },
      { x: 300, y: 260, taken: false },
      { x: 550, y: 220, taken: false },
      { x: 600, y: 220, taken: false },
      { x: 920, y: 280, taken: false },
      { x: 1160, y: 240, taken: false },
      { x: 1600, y: 260, taken: false },
      { x: 1860, y: 220, taken: false },
      { x: 1910, y: 220, taken: false },
    ],
    enemies: [
      { x: 420, y: 0, dir: 1, minX: 380, maxX: 620, alive: true },
      { x: 1020, y: 0, dir: -1, minX: 880, maxX: 1240, alive: true },
      { x: 1700, y: 0, dir: 1, minX: 1540, maxX: 1960, alive: true },
    ]
  };

  // ---------- Entities ----------
  const player = {
    x: LEVEL.player.x, y: LEVEL.player.y,
    w: 18, h: 22,
    vx: 0, vy: 0,
    onGround: false,
    coyote: 0,
    coyoteMax: 0.10,
    face: 1,
    animT: 0,
    coins: 0,
    dead: false,
  };

  const enemyProto = () => ({
    w: 18, h: 18,
    vx: 70,
    vy: 0,
    onGround: false,
    animT: 0,
  });

  const enemies = LEVEL.enemies.map(e => Object.assign(enemyProto(), e));

  // Camera
  const cam = { x: 0, y: 0 };

  // ---------- Collision ----------
  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function resolveCollisions(ent, platforms) {
    // Separate axis resolution
    ent.onGround = false;

    // X
    ent.x += ent.vx * dt;
    for (const p of platforms) {
      if (aabb(ent.x, ent.y, ent.w, ent.h, p.x, p.y, p.w, p.h)) {
        if (ent.vx > 0) ent.x = p.x - ent.w;
        else if (ent.vx < 0) ent.x = p.x + p.w;
        ent.vx = 0;
      }
    }

    // Y
    ent.y += ent.vy * dt;
    for (const p of platforms) {
      if (aabb(ent.x, ent.y, ent.w, ent.h, p.x, p.y, p.w, p.h)) {
        if (ent.vy > 0) {
          ent.y = p.y - ent.h;
          ent.vy = 0;
          ent.onGround = true;
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
    player.coyote = 0;
    player.face = 1;
    player.animT = 0;
    player.dead = false;
    player.coins = 0;

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

  function killPlayer(msg) {
    player.dead = true;
    overlayMsg.textContent = msg || "You fell! Tap/Click to try again.";
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

  function winLevel() {
    overlayMsg.textContent = `Level clear! 💠 ${player.coins}\nTap/Click to replay.`;
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

    // reset one-frame edges
    input.jumpPressed = false;

    requestAnimationFrame(tick);
  }

  // ---------- Update ----------
  function update(dtLocal) {
    // buffer jump
    if (input.jumpBuffer > 0) input.jumpBuffer = Math.max(0, input.jumpBuffer - dtLocal);

    // Horizontal movement
    const accel = player.onGround ? 1150 : 820;
    const maxSpeed = 220;

    if (input.left && !input.right) {
      player.vx -= accel * dtLocal;
      player.face = -1;
    } else if (input.right && !input.left) {
      player.vx += accel * dtLocal;
      player.face = 1;
    } else {
      // friction
      player.vx *= player.onGround ? LEVEL.frictionGround : LEVEL.frictionAir;
      if (Math.abs(player.vx) < 8) player.vx = 0;
    }
    player.vx = clamp(player.vx, -maxSpeed, maxSpeed);

    // Gravity + coyote time
    player.vy += LEVEL.gravity * dtLocal;
    if (player.onGround) player.coyote = player.coyoteMax;
    else player.coyote = Math.max(0, player.coyote - dtLocal);

    // Jump
    const wantJump = (input.jumpPressed || input.jumpBuffer > 0) && (player.onGround || player.coyote > 0);
    if (wantJump) {
      player.vy = -520;
      player.onGround = false;
      player.coyote = 0;
      input.jumpBuffer = 0;
    }
    // Variable jump height
    if (!input.jumpHeld && player.vy < -180) {
      player.vy = -180;
    }

    // Move & collide
    resolveCollisions(player, LEVEL.platforms);

    // Fall death
    if (player.y > LEVEL.height + 200) {
      killPlayer("You fell off the world!\nTap/Click to retry.");
      return;
    }

    // Coins
    for (const c of LEVEL.coins) {
      if (c.taken) continue;
      if (aabb(player.x, player.y, player.w, player.h, c.x, c.y, 12, 12)) {
        c.taken = true;
        player.coins += 1;
        coinPill.textContent = `💠 ${player.coins}`;
      }
    }

    // Enemies
    for (const e of enemies) {
      if (!e.alive) continue;

      e.vy += LEVEL.gravity * dtLocal;
      e.vx = e.dir * 70;

      resolveCollisions(e, LEVEL.platforms);

      if (e.x < e.minX) { e.x = e.minX; e.dir = 1; }
      if (e.x > e.maxX) { e.x = e.maxX; e.dir = -1; }

      // player interaction
      if (aabb(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
        const playerFalling = player.vy > 120;
        const playerAbove = (player.y + player.h) - e.y < 10;
        if (playerFalling && playerAbove) {
          e.alive = false;
          player.vy = -330;
        } else {
          killPlayer("Ouch! Enemy got you.\nTap/Click to retry.");
          return;
        }
      }
    }

    // Goal
    if (aabb(player.x, player.y, player.w, player.h, LEVEL.goal.x, LEVEL.goal.y, LEVEL.goal.w, LEVEL.goal.h)) {
      winLevel();
      return;
    }

    // Camera follow
    const targetX = player.x + player.w/2 - viewW/2;
    cam.x = clamp(lerp(cam.x, targetX, 0.12), 0, LEVEL.width - viewW);
    cam.y = 0;

    // Anim timers
    player.animT += dtLocal;
    for (const e of enemies) e.animT += dtLocal;
  }

  // ---------- Render ----------
  function drawTiledBackground() {
    const img = assets.bg;
    const tile = 32;
    // scale background tile to tile size in world
    const startX = Math.floor(cam.x / tile) * tile;
    const startY = 0;
    for (let y = startY; y < viewH + tile; y += tile) {
      for (let x = startX; x < cam.x + viewW + tile; x += tile) {
        ctx.drawImage(img, 0, 0, 32, 32, Math.floor(x - cam.x), y, tile, tile);
      }
    }
  }

  function drawPlatform(p) {
    // Use platform sprite (48x32) and tile it across the platform width
    const img = assets.env;

    // Top surface: draw platform sprite in 48px chunks
    const chunkW = 48;
    const chunkH = 32;
    for (let x = 0; x < p.w; x += chunkW) {
      const w = Math.min(chunkW, p.w - x);
      ctx.drawImage(
        img,
        ENV.platform.sx, ENV.platform.sy, w, chunkH,
        Math.floor(p.x + x - cam.x), Math.floor(p.y - cam.y - (chunkH - p.h)),
        w, chunkH
      );
    }

    // Add a little rock detail sometimes
    if (p.w >= 180) {
      ctx.drawImage(img, ENV.rock1.sx, ENV.rock1.sy, ENV.rock1.sw, ENV.rock1.sh,
        Math.floor(p.x + 12 - cam.x), Math.floor(p.y + 10 - cam.y),
        ENV.rock1.sw, ENV.rock1.sh
      );
    }
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
    // Clear
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, viewW, viewH);

    // Background
    drawTiledBackground();

    // Platforms
    for (const p of LEVEL.platforms) drawPlatform(p);

    // Goal "gate"
    const gx = Math.floor(LEVEL.goal.x - cam.x);
    const gy = Math.floor(LEVEL.goal.y - cam.y);
    ctx.fillStyle = "rgba(210, 240, 255, 0.15)";
    ctx.fillRect(gx, gy, LEVEL.goal.w, LEVEL.goal.h);
    ctx.strokeStyle = "rgba(140, 200, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(gx + 1, gy + 1, LEVEL.goal.w - 2, LEVEL.goal.h - 2);
    ctx.fillStyle = "rgba(140, 200, 255, 0.30)";
    ctx.fillRect(gx + 6, gy + 6, LEVEL.goal.w - 12, LEVEL.goal.h - 12);

    // Coins
    const sheet = assets.sheet;
    for (const c of LEVEL.coins) {
      if (c.taken) continue;
      const t = performance.now() / 1000;
      const bob = Math.sin(t * 6 + c.x * 0.02) * 2;
      const frame = SPRITES.coin[Math.floor((t * 8) % SPRITES.coin.length)];
      drawSpriteFrame(sheet, frame, c.x - cam.x, c.y - cam.y + bob, 14, 14, false);
    }

    // Enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      const t = e.animT;
      const frame = SPRITES.enemyIdle[Math.floor((t * 8) % SPRITES.enemyIdle.length)];
      drawSpriteFrame(sheet, frame, e.x - cam.x, e.y - cam.y, 20, 20, e.dir < 0);
    }

    // Player
    const pt = player.animT;
    const moving = Math.abs(player.vx) > 15;
    const frames = SPRITES.playerIdle;
    const frame = frames[Math.floor((pt * (moving ? 10 : 6)) % frames.length)];
    drawSpriteFrame(sheet, frame, player.x - cam.x, player.y - cam.y, 22, 22, player.face < 0);

    // Simple vignette
    const grd = ctx.createRadialGradient(viewW/2, viewH/2, 40, viewW/2, viewH/2, Math.max(viewW, viewH));
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,viewW,viewH);
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
