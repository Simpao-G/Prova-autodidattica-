/* Cronometro dell'Animeteca per AnimeSaturn.
 *
 * Questo file viene caricato in due modi:
 *  - dall'Animeteca (index.html, con data-define-only): definisce soltanto la funzione,
 *    che l'app usa per creare la versione "lunga" del segnalibro;
 *  - dal segnalibro "corto", sulla pagina di AnimeSaturn: avvia il cronometro.
 * Cos\u00EC il segnalibro resta corto (Brave non accetta indirizzi troppo lunghi) e il
 * cronometro si pu\u00F2 migliorare senza dover rifare il segnalibro.
 */
(function () {
  // ATTENZIONE: dentro saturnBookmarklet niente commenti "//" e sempre il ";"
  // (per la versione lunga del segnalibro il codice viene compresso su una riga).
    function saturnBookmarklet(APP) {
      if (window.__animeteca) {
        window.__animeteca.flash();
        return;
      }
      var host = location.hostname;
      if (host.indexOf("animesaturn") < 0 && !confirm("Questa pagina non sembra AnimeSaturn. Vuoi contare il tempo lo stesso?")) return;
      var K = "animeteca_tempo";
      var pad = function (n) {
        return String(n).padStart(2, "0");
      };
      var today = function () {
        var d = new Date();
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      };
      var read = function () {
        try {
          return JSON.parse(localStorage.getItem(K)) || {};
        } catch (e) {
          return {};
        }
      };
      var write = function (o) {
        try {
          localStorage.setItem(K, JSON.stringify(o));
        } catch (e) {}
      };
      var fmt = function (s) {
        var h = Math.floor(s / 3600);
        var m = Math.floor((s - h * 3600) / 60);
        return h + ":" + pad(m) + ":" + pad(Math.floor(s - h * 3600 - m * 60));
      };
      var box = document.createElement("div");
      var root = box.attachShadow ? box.attachShadow({ mode: "open" }) : box;
      root.innerHTML =
        "<style>" +
        ".b{position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;gap:8px;" +
        "padding:8px 8px 8px 12px;border-radius:16px;background:rgb(36,31,58);color:rgb(243,240,255);" +
        "border:1px solid rgb(74,222,128);box-shadow:0 8px 24px rgba(0,0,0,.5);" +
        "font:600 14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif}" +
        ".d{width:9px;height:9px;border-radius:50px;background:rgb(74,222,128)}" +
        "button{border:0;border-radius:11px;padding:7px 11px;font:700 13px -apple-system,system-ui,sans-serif;cursor:pointer}" +
        ".s{background:rgb(74,222,128);color:rgb(16,37,26)}.x{background:rgba(255,255,255,.12);color:rgb(243,240,255)}" +
        "</style><div class=b><span class=d></span><span class=t></span>" +
        "<button class=s>Invia</button><button class=x>\u2715</button></div>";
      (document.body || document.documentElement).appendChild(box);
      var bar = root.querySelector(".b");
      var label = root.querySelector(".t");
      var dot = root.querySelector(".d");
      var last = Date.now();
      var tick = function () {
        var now = Date.now();
        var dt = Math.min(now - last, 5000);
        last = now;
        var o = read();
        var k = today();
        if (document.visibilityState === "visible") {
          o[k] = (o[k] || 0) + dt / 1000;
          write(o);
          dot.style.opacity = "1";
        } else {
          dot.style.opacity = "0.3";
        }
        label.textContent = "\u23F1 AnimeSaturn \u00B7 oggi " + fmt(o[k] || 0);
      };
      var timer = setInterval(tick, 1000);
      tick();
      root.querySelector(".s").onclick = function () {
        var o = read();
        var d = {};
        Object.keys(o).forEach(function (k) {
          if (o[k] >= 30) d[k] = Math.round(o[k]);
        });
        var url = APP + "?saturn=" + encodeURIComponent(JSON.stringify({ h: host, d: d }));
        var w = window.open(url, "_blank");
        if (!w) location.href = url;
      };
      root.querySelector(".x").onclick = function () {
        clearInterval(timer);
        box.remove();
        window.__animeteca = null;
      };
      window.__animeteca = {
        flash: function () {
          bar.style.transform = "scale(1.08)";
          setTimeout(function () {
            bar.style.transform = "";
          }, 250);
        },
      };
    }

  var me = document.currentScript;
  if (me && me.hasAttribute("data-define-only")) {
    window.saturnBookmarklet = saturnBookmarklet;
  } else {
    var app = me && me.src ? new URL(".", me.src).href : "https://simpao-g.github.io/Prova-autodidattica-/";
    saturnBookmarklet(app);
  }
})();
