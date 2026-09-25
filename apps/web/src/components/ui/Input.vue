<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
const model = defineModel<string>({ default: "" });
</script>
<template>
  <input
    v-model="model"
    :class="
      cn(
        'flex h-12 w-full rounded-xl border border-input bg-background px-4 text-sm shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/60 focus-visible:border-violet-400 focus-visible:ring-4 focus-visible:ring-violet-500/10 disabled:opacity-50',
        props.class,
      )
    "
  />
</template>
