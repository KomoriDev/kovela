import { createRouter, createWebHistory } from "vue-router";

declare module "vue-router" {
  interface RouteMeta {
    /** Navigation label, also shown on the transition curtain. */
    label: string;
    /** Latin caption printed next to the label. */
    caption: string;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "overview",
      component: () => import("./pages/OverviewPage.vue"),
      meta: { label: "总览", caption: "Overview" },
    },
    {
      path: "/about",
      name: "about",
      component: () => import("./pages/AboutPage.vue"),
      meta: { label: "关于", caption: "About" },
    },
    { path: "/:rest(.*)*", redirect: "/" },
  ],
  // The page transition resets scroll while the curtain covers the viewport.
  scrollBehavior: () => false,
});

router.afterEach((to) => {
  document.title = to.name === "overview" ? "Kovela" : `${to.meta.label} · Kovela`;
});
