import { createApp, markRaw } from "vue";
import "lenis/dist/lenis.css";
import "./styles/base.css";

const isAdmin = location.pathname.replace(/\/$/, "") === "/admin";
let app: ReturnType<typeof createApp>;
let teardown = () => {};

if (isAdmin) {
  // Only the admin console talks to the Kovela service; the public site is static.
  const [{ Context }, { default: KovelaClient }, { contextKey }, { default: Admin }] =
    await Promise.all([
      import("cordis"),
      import("@kovela/client"),
      import("./context"),
      import("./Admin.vue"),
      import("./styles/admin.css"),
    ]);
  const root = new Context();
  root.plugin(KovelaClient);
  await root.start();
  app = createApp(Admin);
  app.provide(contextKey, markRaw(root));
  teardown = () => void root.stop();
} else {
  const [{ default: App }, { router }, smooth] = await Promise.all([
    import("./App.vue"),
    import("./router"),
    import("./motion/smooth"),
  ]);
  app = createApp(App).use(router);
  smooth.startSmooth();
  teardown = smooth.stopSmooth;
}

app.mount("#app");

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    app.unmount();
    teardown();
  });
