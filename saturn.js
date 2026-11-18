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
        ".b{position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;gap:10px;" +
        "padding:7px 7px 7px 12px;border-radius:12px;background:rgb(20,20,22);color:rgb(244,243,239);" +
        "border:1px solid rgba(255,255,255,.16);box-shadow:0 10px 28px rgba(0,0,0,.5);" +
        "font:500 13px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;transition:transform .2s}" +
        ".m{width:12px;height:15px;flex:none}" +
        ".t{font-variant-numeric:tabular-nums;white-space:nowrap}" +
        ".d{width:7px;height:7px;border-radius:50px;background:rgb(245,197,66);flex:none}" +
        "button{border:0;border-radius:8px;height:32px;padding:0 12px;font:700 13px -apple-system,system-ui,sans-serif;cursor:pointer}" +
        ".s{background:rgb(245,197,66);color:rgb(23,20,10)}" +
        ".x{width:32px;padding:0;display:grid;place-items:center;background:none;color:rgb(168,167,161)}" +
        "</style><div class=b>" +
        "<svg class=m viewBox='0 0 22 26' aria-hidden=true><path fill='rgb(245,197,66)' d='M3 0h16a3 3 0 0 1 3 3v21.1a1.2 1.2 0 0 1-1.86 1L11 19.4l-9.14 5.7A1.2 1.2 0 0 1 0 24.1V3a3 3 0 0 1 3-3Z'/>" +
        "<path fill='rgb(20,20,22)' d='M8.4 6.4v7.9l6.7-3.95Z'/></svg>" +
        "<span class=d></span><span class=t></span>" +
        "<button class=s>Invia</button>" +
        "<button class=x aria-label=Chiudi><svg width=16 height=16 viewBox='0 0 24 24' fill=none stroke=currentColor stroke-width=2 stroke-linecap=round aria-hidden=true><path d='m6.5 6.5 11 11m0-11-11 11'/></svg></button></div>";
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
        label.textContent = "AnimeSaturn \u00B7 oggi " + fmt(o[k] || 0);
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
          bar.style.transform = "scale(1.06)";
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
