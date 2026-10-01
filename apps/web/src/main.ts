import { createApp, markRaw } from "vue";
import { Context } from "cordis";
import KovelaClient from "@kovela/client";
import App from "./App.vue";
import Admin from "./Admin.vue";
import { contextKey } from "./context";
import "./style.css";

const root = new Context();
root.plugin(KovelaClient);
await root.start();
const app = createApp(location.pathname.replace(/\/$/, "") === "/admin" ? Admin : App);
app.provide(contextKey, markRaw(root));
app.mount("#app");
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    app.unmount();
    void root.stop();
  });
