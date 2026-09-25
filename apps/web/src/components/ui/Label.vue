<script setup lang="ts">
import { Label, type LabelProps } from "reka-ui";
import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "vue";
const props = defineProps<LabelProps & { class?: HTMLAttributes["class"] }>();
</script>
<template>
  <Label
    :for="props.for"
    :class="cn('text-sm font-medium leading-none', props.class)"
    ><slot
  /></Label>
</template>
