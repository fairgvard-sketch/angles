import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(projectRoot, "ANGLE Landing Page.dc.html");
const loginSourcePath = path.join(projectRoot, "login.html");
const outputRoot = path.join(projectRoot, "dist");

const source = await readFile(sourcePath, "utf8");
const loginSource = await readFile(loginSourcePath, "utf8");
const helmetMatch = source.match(/<helmet>\s*([\s\S]*?)\s*<\/helmet>/);

if (!helmetMatch) {
  throw new Error("The source page is missing its <helmet> block.");
}

const metadata = `
<title>ANGLE - POS, payments and operations for hospitality</title>
<meta name="description" content="ANGLE brings point of sale, payments, reservations, QR menus and daily hospitality operations into one connected system.">
<meta name="theme-color" content="#0D0D0D">
<link rel="icon" type="image/png" href="favicon.png">
<link rel="apple-touch-icon" href="favicon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="ANGLE - Simple business starts here">
<meta property="og:description" content="Modern POS, payments and operations for restaurants, cafes, bars, pizzerias and bakeries.">
`;

let html = source
  .replace('<script src="./support.js"></script>', "")
  .replace(helmetMatch[0], "")
  .replace(/<x-dc>\s*/, "")
  .replace(/\s*<\/x-dc>/, "")
  .replace(/<script type="text\/x-dc"[\s\S]*?<\/script>\s*/, "")
  .replace(
    /<x-import\s+component-from-global-scope="image-slot"[^>]*id="hero-photo"[^>]*><\/x-import>/,
    '<img src="uploads/hero.png" alt="Barista using ANGLE point of sale in a cafe" style="position:absolute; inset:0; width:100%; height:100%; display:block; object-fit:cover">'
  )
  .replace("</head>", `${metadata}${helmetMatch[1]}\n</head>`);

if (/<x-dc|<x-import|text\/x-dc|support\.js|image-slot\.js/.test(html)) {
  throw new Error("Editor-only markup remains in the production page.");
}

const assetPaths = new Set([
  "anglelogo.png",
  "favicon.png",
  // Фото hero демо-брони — подключается из demo/reservation-demo.js, а не из
  // HTML, поэтому regex ниже его не находит; копируем явно.
  "uploads/ver.webp",
  ...Array.from(html.matchAll(/(?:src=["']|url\(["']?)(uploads\/[A-Za-z0-9_./-]+)/g), (match) => match[1])
]);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, "index.html"), html, "utf8");
await mkdir(path.join(outputRoot, "login"), { recursive: true });
await writeFile(path.join(outputRoot, "login", "index.html"), loginSource, "utf8");

for (const relativePath of assetPaths) {
  const from = path.join(projectRoot, relativePath);
  const to = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

await cp(path.join(projectRoot, "demo"), path.join(outputRoot, "demo"), { recursive: true });
await cp(path.join(projectRoot, "uploads", "qr-demo"), path.join(outputRoot, "uploads", "qr-demo"), { recursive: true });
await cp(
  path.join(projectRoot, "uploads", "menu-backgrounds"),
  path.join(outputRoot, "uploads", "menu-backgrounds"),
  { recursive: true }
);

console.log(`Built dist/index.html with ${assetPaths.size} production assets.`);
