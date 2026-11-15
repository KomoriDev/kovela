<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import BandDevice from "./BandDevice.vue";
import { gameById } from "../data/games";
import { finePointer, gsap, MEDIA, prefersReducedMotion } from "../motion/gsap";
import { useGsap } from "../motion/useGsap";
import { revealGate } from "../stores/ui";

const birds = gameById("angrybirds");
const melon = gameById("watermelon");
const root = ref<HTMLElement>();
const animated = !prefersReducedMotion();
let detach = () => {};

useGsap(root, (context) => {
  const el = root.value;
  if (!el) return;
  const mm = gsap.matchMedia();
  mm.add(MEDIA.motion, () => {
    gsap.set(".float", { opacity: 0, y: 160, rotate: 6 });
    gsap.set(".orbit", { opacity: 0, scale: 0.8 });
    void revealGate().then(() =>
      context.add(() => {
        gsap
          .timeline({ delay: 0.15 })
          .to(".orbit", { opacity: 1, scale: 1, duration: 2.2 })
          .to(
            ".float",
            { opacity: 1, y: 0, rotate: 0, duration: 1.8, stagger: 0.14 },
            0.1,
          )
          .add(() => {
            gsap.to(".float-a", {
              y: -14,
              duration: 3.6,
              ease: "sine.inOut",
              yoyo: true,
              repeat: -1,
            });
            gsap.to(".float-b", {
              y: 16,
              duration: 4.2,
              ease: "sine.inOut",
              yoyo: true,
              repeat: -1,
            });
          });
      }),
    );

    // Scroll away: the stack drifts up and the aurora dims.
    gsap.to(".stack", {
      yPercent: -18,
      ease: "none",
      scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: true },
    });
    gsap.to(".aurora", {
      opacity: 0.25,
      ease: "none",
      scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: true },
    });

    if (!finePointer()) return;
    const stack = el.querySelector<HTMLElement>(".tilt");
    if (!stack) return;
    const rx = gsap.quickTo(stack, "rotationX", { duration: 1.2, ease: "power3.out" });
    const ry = gsap.quickTo(stack, "rotationY", { duration: 1.2, ease: "power3.out" });
    const move = (event: PointerEvent) => {
      const x = event.clientX / window.innerWidth - 0.5;
      const y = event.clientY / window.innerHeight - 0.5;
      ry(x * 16);
      rx(y * -12);
    };
    window.addEventListener("pointermove", move, { passive: true });
    detach = () => window.removeEventListener("pointermove", move);
    return () => detach();
  });
});
onBeforeUnmount(() => detach());
</script>

<template>
  <div ref="root" class="visual" aria-hidden="true">
    <div class="aurora">
      <span class="blob blob-a" />
      <span class="blob blob-b" />
      <span class="blob blob-c" />
    </div>

    <svg class="orbit" viewBox="-320 -320 640 640" fill="none">
      <defs>
        <linearGradient id="orbit-stroke" x1="-300" y1="0" x2="300" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#2f7dff" stop-opacity="0" />
          <stop offset="0.5" stop-color="#12a9d6" stop-opacity="0.75" />
          <stop offset="1" stop-color="#19c18f" stop-opacity="0.1" />
        </linearGradient>
      </defs>
      <g transform="rotate(-16)">
        <ellipse rx="300" ry="96" stroke="url(#orbit-stroke)" stroke-width="1.2" />
        <circle r="5" fill="#2f7dff">
          <animateMotion
            v-if="animated"
            dur="16s"
            repeatCount="indefinite"
            path="M -300 0 A 300 96 0 1 0 300 0 A 300 96 0 1 0 -300 0"
          />
        </circle>
      </g>
      <g transform="rotate(24)">
        <ellipse rx="250" ry="62" stroke="rgba(18,20,25,0.14)" stroke-dasharray="2 8" />
      </g>
    </svg>

    <div class="stack">
      <div class="tilt">
        <div class="float float-a">
          <BandDevice
            class="band-land"
            :shots="birds.shots"
            frame="land"
            :label="birds.name"
            :interval="3800"
            :style="{ '--band-glow': 'rgba(255, 90, 60, 0.45)' }"
          />
        </div>
        <div class="float float-b">
          <BandDevice
            class="band-port"
            :shots="melon.shots"
            frame="port"
            :label="melon.name"
            :interval="4600"
            :style="{ '--band-glow': 'rgba(95, 211, 138, 0.5)' }"
          />
        </div>
        <svg class="spark" viewBox="0 0 24 24" width="40" height="40">
          <path
            d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5C11.4 16.9 7.1 12.6 1.5 12 7.1 11.4 11.4 7.1 12 1.5Z"
            fill="currentColor"
          />
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.visual {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.aurora {
  position: absolute;
  inset: -10%;
  filter: blur(70px) saturate(1.2);
}
.blob {
  position: absolute;
  border-radius: 50%;
  opacity: 0.42;
  mix-blend-mode: multiply;
}
.blob-a {
  top: 12%;
  right: 8%;
  width: 42vw;
  height: 42vw;
  background: radial-gradient(circle, #7fb0ff 0%, transparent 65%);
  animation: drift-a 22s ease-in-out infinite alternate;
}
.blob-b {
  top: 38%;
  right: 26%;
  width: 34vw;
  height: 34vw;
  background: radial-gradient(circle, #74dcf0 0%, transparent 65%);
  animation: drift-b 26s ease-in-out infinite alternate;
}
.blob-c {
  top: 0;
  right: 34%;
  width: 26vw;
  height: 26vw;
  background: radial-gradient(circle, #8ff0cc 0%, transparent 65%);
  opacity: 0.4;
  animation: drift-c 30s ease-in-out infinite alternate;
}
@keyframes drift-a {
  to {
    transform: translate(-8vw, 10vh) scale(1.15);
  }
}
@keyframes drift-b {
  to {
    transform: translate(10vw, -8vh) scale(0.9);
  }
}
@keyframes drift-c {
  to {
    transform: translate(-6vw, 16vh) scale(1.2);
  }
}

.orbit {
  position: absolute;
  top: 50%;
  right: max(-4vw, calc(50% - 760px));
  width: min(72vw, 980px);
  translate: 0 -46%;
  overflow: visible;
}

.stack {
  position: absolute;
  top: 50%;
  right: max(2vw, calc(50% - 640px));
  width: min(52vw, 700px);
  aspect-ratio: 1 / 0.86;
  translate: 0 -44%;
  perspective: 1400px;
}
.tilt {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
}
.float {
  position: absolute;
}
.float-a {
  top: 10%;
  left: 0;
}
.float-b {
  top: 4%;
  right: 6%;
}
.band-land {
  --band-w: min(36vw, 480px);
  rotate: -9deg;
}
.band-port {
  --band-w: min(13.5vw, 182px);
  rotate: 8deg;
}
.spark {
  position: absolute;
  right: 0;
  bottom: 18%;
  color: #12a9d6;
  filter: drop-shadow(0 0 14px rgba(18, 169, 214, 0.55));
  animation: twinkle 3.2s ease-in-out infinite;
}
@keyframes twinkle {
  50% {
    opacity: 0.35;
    transform: scale(0.7) rotate(45deg);
  }
}

@media (max-width: 899px) {
  .orbit {
    top: 30%;
    right: -30%;
    width: 150vw;
  }
  .stack {
    top: 6.5rem;
    right: 50%;
    width: min(94vw, 520px);
    translate: 50% 0;
  }
  .float-a {
    top: 14%;
    left: 5%;
  }
  .band-land {
    --band-w: min(60vw, 340px);
  }
  .band-port {
    --band-w: min(24vw, 130px);
  }
  .blob-a {
    width: 90vw;
    height: 90vw;
  }
  .blob-b {
    width: 70vw;
    height: 70vw;
  }
  .blob-c {
    width: 60vw;
    height: 60vw;
  }
}

@media (prefers-reduced-motion: reduce) {
  .blob,
  .spark {
    animation: none;
  }
}
</style>
