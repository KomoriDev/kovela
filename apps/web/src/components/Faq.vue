<script setup lang="ts">
import {
  AccordionContent,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
} from "reka-ui";
import { ChevronDown } from "@lucide/vue";
const questions = [
  {
    q: "订单号在哪里查看？",
    a: "打开爱发电 → 我的订单 → 订单详情，复制订单号。请选择订单对应的应用，填写已完成购买或免费兑换的订单；不要填写支付平台流水号。",
  },
  {
    q: "什么时候会收到爱发电私信？",
    a: "订单完成后会收到激活引导和订单号。手环保存许可证并回执后，才会再收到激活结果；购买或兑换本身不会附带授权码。",
  },
  {
    q: "需要在手环上输入很长的授权码吗？",
    a: "不需要。在 AstroBox 的 Kovela 插件里输入订单号，插件会验证订单并把设备绑定许可证传给手环。本页仍可验证，但不是必须。请先安装 AstroBox v2 与 Kovela 插件，并连接手环。",
  },
  {
    q: "激活后还需要连接手机吗？",
    a: "许可证保存成功后，应用可离线使用。首次激活和重新传输许可证需要手机联网、AstroBox 连接设备，并保持手环应用打开。",
  },
  {
    q: "可以换设备或重复激活吗？",
    a: "同一订单内，每个应用的授权独立绑定一台设备。同设备可以重新领取，不同设备不能重复绑定。需要换设备时请联系创作者。请勿公开订单号。",
  },
];
</script>
<template>
  <AccordionRoot type="single" collapsible class="divide-y divide-border">
    <AccordionItem
      v-for="(item, index) in questions"
      :key="item.q"
      :value="String(index)"
      class="group py-1"
    >
      <AccordionTrigger
        class="flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-medium outline-none focus-visible:text-primary"
        >{{ item.q
        }}<ChevronDown
          class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
      /></AccordionTrigger>
      <AccordionContent class="pb-5 text-sm leading-7 text-muted-foreground">{{
        item.a
      }}</AccordionContent>
    </AccordionItem>
  </AccordionRoot>
</template>
