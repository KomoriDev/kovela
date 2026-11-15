import { onBeforeUnmount, onMounted, type Ref } from "vue";
import { gsap } from "./gsap";

/**
 * Runs `setup` inside a gsap.context scoped to `root` once mounted, and reverts
 * every tween, ScrollTrigger and matchMedia it created when the component unmounts.
 */
export function useGsap(
  root: Ref<HTMLElement | undefined>,
  setup: (context: gsap.Context) => void,
): void {
  let context: gsap.Context | undefined;
  onMounted(() => {
    context = gsap.context((self) => setup(self), root.value);
  });
  onBeforeUnmount(() => {
    context?.revert();
    context = undefined;
  });
}
