// Hue-shifts the favicon on localhost so local tabs are distinguishable from the deployed game.
export function tintFaviconOnLocalhost(): void {
  if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"][sizes="32x32"]');
  if (!link) return;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.filter = "hue-rotate(150deg) saturate(1.4)";
    ctx.drawImage(img, 0, 0, 32, 32);
    document.querySelectorAll('link[rel="icon"]').forEach((el) => el.remove());
    const tinted = document.createElement("link");
    tinted.rel = "icon";
    tinted.type = "image/png";
    tinted.href = canvas.toDataURL("image/png");
    document.head.appendChild(tinted);
  };
  img.src = link.href;
}
