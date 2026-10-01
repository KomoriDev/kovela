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
    a: "打开爱发电 → 消息 → 查看私信，获取订单号。已完成的购买和免费兑换订单都可以用，不要填支付平台流水号。",
  },
  {
    q: "需要输入很长的授权码吗？",
    a: "不需要。激活只需一个订单号：在 AstroBox 的 Kovela 插件中输入，插件会自动完成验证并把许可证写入手环。本页仅用于查询订单信息。",
  },
  {
    q: "什么时候会收到爱发电私信？",
    a: "订单完成后会收到激活引导和订单号；手环保存许可证并回执后，会再收到激活结果。购买或兑换不会附带授权码。",
  },
  {
    q: "为什么提示无法连接服务？网站能打开，插件却连不上？",
    a: "Kovela 部署在 Cloudflare。受中国大陆部分地区、运营商网络的访问限制影响，部分 Cloudflare 节点可能无法连接；网页能打开，也不代表 AstroBox 的接口请求一定可达。这通常与订单是否有效无关。可先切换 Wi-Fi 或移动网络重试；仍无法连接时，在插件的红色服务异常原因区点击「尝试离线激活」，获取并复制激活申请，私信发给创作者。创作者在可用网络上核单并签发许可证后，你可导入许可证完成激活，此过程仍需 AstroBox 通过蓝牙连接手环。",
  },
  {
    q: "激活后还需要连接手机吗？",
    a: "不需要。许可证保存成功后即可离线使用。仅首次激活和重新传输许可证时需要连接：手机联网、AstroBox 连接手环，并保持应用打开。",
  },
  {
    q: "可以换设备或重复激活吗？",
    a: "每个应用的授权只绑定一台设备。同一设备可重复激活，不同设备不能换绑；确需更换请联系创作者。请勿公开订单号。",
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
