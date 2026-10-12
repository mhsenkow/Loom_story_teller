// =================================================================
// themeBootstrap — pre-hydration theme on <html> (LOOM-044)
// =================================================================

/** Minified IIFE: read loom-app-settings or prefers-color-scheme before paint. */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t="dark",k="loom-app-settings",raw=localStorage.getItem(k);if(raw){var s=JSON.parse(raw);if(s&&s.theme)t=s.theme==="high-contrast"?"contrast":s.theme;}else if(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)t="light";var el=document.documentElement;el.setAttribute("data-theme",t);if(t==="light"||t==="paper"||t==="nes")el.classList.remove("dark");else el.classList.add("dark");}catch(e){}})();`;
