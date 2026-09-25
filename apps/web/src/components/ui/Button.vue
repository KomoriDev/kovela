<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";
const variants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-500/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-violet-700 shadow-sm shadow-violet-600/15",
        outline: "border border-border bg-background hover:bg-muted",
        ghost: "hover:bg-muted text-muted-foreground",
      },
      size: { default: "h-11 px-5", sm: "h-9 px-3 text-xs", icon: "size-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
type Variants = VariantProps<typeof variants>;
const props = withDefaults(
  defineProps<
    PrimitiveProps & {
      variant?: Variants["variant"];
      size?: Variants["size"];
      class?: HTMLAttributes["class"];
    }
  >(),
  { as: "button" },
);
</script>
<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn(variants({ variant, size }), props.class)"
    ><slot
  /></Primitive>
</template>
