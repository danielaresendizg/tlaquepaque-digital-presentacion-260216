import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const out = { flows: "main", loops: "" };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k.startsWith("--")) continue;
    i++;
    if (k === "--in") out.inPath = v;
    else if (k === "--out") out.outPath = v;
    else if (k === "--flows") out.flows = v || "";
    else if (k === "--loops") out.loops = v || "";
  }
  if (!out.inPath || !out.outPath) {
    throw new Error("Usage: node export_static_svg.mjs --in <index.html> --out <out.svg> [--flows main,fiscal,...] [--loops r1,r2,...]");
  }
  return out;
}

function decodeHtmlEntities(s) {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&laquo;", "«")
    .replaceAll("&raquo;", "»")
    .replaceAll("&rarr;", "→")
    .replaceAll("&#39;", "'")
    .replaceAll("&oacute;", "ó")
    .replaceAll("&aacute;", "á")
    .replaceAll("&eacute;", "é")
    .replaceAll("&iacute;", "í")
    .replaceAll("&uacute;", "ú")
    .replaceAll("&ntilde;", "ñ")
    .replaceAll("&Oacute;", "Ó")
    .replaceAll("&Aacute;", "Á")
    .replaceAll("&Eacute;", "É")
    .replaceAll("&Iacute;", "Í")
    .replaceAll("&Uacute;", "Ú")
    .replaceAll("&Ntilde;", "Ñ");
}

function escXml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapWords(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) {
      line = w;
      continue;
    }
    if ((line + " " + w).length <= maxChars) {
      line += " " + w;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pickNodeTheme(className) {
  if (className.includes("n-e1")) return { fill: "#00134D", stroke: "#00134D", ink: "#ffffff" };
  if (className.includes("n-e2")) return { fill: "#0000FF", stroke: "#0000FF", ink: "#ffffff" };
  if (className.includes("n-e3")) return { fill: "#C5E2FF", stroke: "#C5E2FF", ink: "#0000FF" };
  if (className.includes("n-tr")) return { fill: "#FF0000", stroke: "#FF0000", ink: "#ffffff" };
  return { fill: "#ffffff", stroke: "#000000", ink: "#000000" };
}

function parsePxStyle(style, key) {
  const m = style.match(new RegExp(`${key}:\\s*([0-9.]+)px`, "i"));
  return m ? Number(m[1]) : null;
}

function main() {
  const args = parseArgs(process.argv);
  const html = readFileSync(args.inPath, "utf8");

  const flowsOn = new Set(
    (args.flows || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  const loopsOn = new Set(
    (args.loops || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  // SVG links: extract defs + content, keep original classes for toggling.
  const linksMatch = html.match(/<svg class="links"[^>]*>([\s\S]*?)<\/svg>/i);
  if (!linksMatch) throw new Error("Could not find <svg class=\"links\">");
  const linksInner = linksMatch[1];
  const defsMatch = linksInner.match(/<defs>([\s\S]*?)<\/defs>/i);
  const defsInner = defsMatch ? defsMatch[1] : "";
  const linksNoDefs = linksInner.replace(/<defs>[\s\S]*?<\/defs>/i, "");

  function flowHiddenCss(flow) {
    return flowsOn.has(flow) ? "" : `svg:not(.show-${flow}) .flow-${flow}{display:none !important;}\n`;
  }
  function loopHiddenCss(loop) {
    return loopsOn.has(loop) ? "" : `svg:not(.show-loop-${loop}) .loop-${loop}-el{display:none !important;}\n`;
  }

  // Phases
  const phases = [];
  for (const m of html.matchAll(/<div class="phase"[^>]*style="([^"]+)"[^>]*>([^<]+)<\/div>/gi)) {
    const top = parsePxStyle(m[1], "top");
    phases.push({ top, text: decodeHtmlEntities(m[2].trim()) });
  }

  // Stage dividers
  const dividers = [];
  for (const m of html.matchAll(/<div class="stage-divider"[^>]*style="([^"]+)"[^>]*><\/div>/gi)) {
    const top = parsePxStyle(m[1], "top");
    dividers.push({ top });
  }

  // Nodes
  const nodes = [];
  for (const m of html.matchAll(/<article class="node ([^"]+)"[^>]*style="([^"]+)"[^>]*>[\s\S]*?<h4>([\s\S]*?)<\/h4>[\s\S]*?<p>([\s\S]*?)<\/p>[\s\S]*?<\/article>/gi)) {
    const cls = m[1];
    const style = m[2];
    const left = parsePxStyle(style, "left");
    const top = parsePxStyle(style, "top");
    const title = decodeHtmlEntities(m[3].replace(/<[^>]+>/g, "").trim());
    const body = decodeHtmlEntities(m[4].replace(/<[^>]+>/g, "").trim());
    nodes.push({ cls, left, top, title, body });
  }

  // Results
  const results = [];
  for (const m of html.matchAll(/<div class="result([^"]*)"[^>]*style="([^"]+)"[^>]*>([\s\S]*?)<small>([\s\S]*?)<\/small>[\s\S]*?<\/div>/gi)) {
    const cls = m[1] || "";
    const style = m[2];
    const left = parsePxStyle(style, "left");
    const top = parsePxStyle(style, "top");
    const head = decodeHtmlEntities(m[3].replace(/<[^>]+>/g, "").trim());
    const sub = decodeHtmlEntities(m[4].replace(/<[^>]+>/g, "").trim());
    results.push({ cls, left, top, head, sub });
  }

  // Edge labels
  const edgeLabels = [];
  for (const m of html.matchAll(/<div class="edge-label ([^"]+)"[^>]*style="([^"]+)"[^>]*>([\s\S]*?)<\/div>/gi)) {
    const cls = m[1] || "";
    const style = m[2] || "";
    const left = parsePxStyle(style, "left");
    const top = parsePxStyle(style, "top");
    const text = decodeHtmlEntities(m[3].replace(/<[^>]+>/g, "").trim());
    const colorMatch = style.match(/color:\s*([^;]+);/i);
    edgeLabels.push({ cls, left, top, text, color: colorMatch ? colorMatch[1].trim() : null });
  }

  // Loop chips
  const loopChips = [];
  for (const m of html.matchAll(/<div class="loop-chip ([^"]+)"[^>]*style="([^"]+)"[^>]*>([A-Z0-9]+)<small>([\s\S]*?)<\/small><\/div>/gi)) {
    const cls = m[1];
    const style = m[2];
    const left = parsePxStyle(style, "left");
    const top = parsePxStyle(style, "top");
    const code = decodeHtmlEntities(m[3].trim());
    const sub = decodeHtmlEntities(m[4].replace(/<[^>]+>/g, "").trim());
    loopChips.push({ cls, left, top, code, sub });
  }

  // IDE lane
  const ideMatch = html.match(/<div class="ide-lane">([\s\S]*?)<small>([\s\S]*?)<\/small>[\s\S]*?<\/div>/i);
  const ideTitle = ideMatch ? decodeHtmlEntities(ideMatch[1].replace(/<[^>]+>/g, "").trim()) : "";
  const ideSub = ideMatch ? decodeHtmlEntities(ideMatch[2].replace(/<[^>]+>/g, "").trim()) : "";

  const rootClasses = [
    ...Array.from(flowsOn).map((f) => `show-${f}`),
    ...Array.from(loopsOn).map((l) => `show-loop-${l}`),
  ].join(" ");

  let svg = "";
  svg += `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2300" viewBox="0 0 3000 2300" class="${escXml(rootClasses)}">\n`;
  svg += `<defs>\n${defsInner}\n</defs>\n`;
  svg += `<style>\n`;
  svg += `text{font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;}\n`;
  svg += `.phase{font-size:28px;font-weight:900;letter-spacing:0.08em;fill:#0000ff;}\n`;
  svg += `.divider{stroke: rgba(148,163,184,0.35);stroke-width:1;}\n`;
  svg += `.node-rect{rx:12;ry:12;stroke-width:3;}\n`;
  svg += `.node-title{font-size:24px;font-weight:800;text-transform:uppercase;}\n`;
  svg += `.node-body{font-size:18px;font-weight:560;}\n`;
  svg += `.result-rect{rx:10;ry:10;stroke-width:2;fill:#ffffff;}\n`;
  svg += `.result-title{font-size:18px;font-weight:740;letter-spacing:0.04em;text-transform:uppercase;}\n`;
  svg += `.result-sub{font-size:14px;font-weight:580;}\n`;
  svg += `.edge-text{font-size:26px;font-weight:760;}\n`;
  svg += `.ide-rect{rx:12;ry:12;stroke-width:4;fill:#0000ff;stroke:#0000ff;}\n`;
  svg += `.ide-title{font-size:64px;font-weight:780;fill:#ffffff;}\n`;
  svg += `.ide-sub{font-size:36px;font-weight:560;fill:#ffffff;}\n`;
  svg += `.loop-chip-rect{rx:8;ry:8;stroke:none;}\n`;
  svg += `.loop-chip-code{font-size:22px;font-weight:800;}\n`;
  svg += `.loop-chip-sub{font-size:14px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;}\n`;

  // Flow/loop visibility controls (default: only main visible unless explicitly enabled).
  svg += `svg .flow-main{display:none;}\nsvg.show-main .flow-main{display:inline;}\n`;
  svg += `svg .flow-feedback{display:none;}\nsvg.show-feedback .flow-feedback{display:inline;}\n`;
  svg += `svg .flow-participacion{display:none;}\nsvg.show-participacion .flow-participacion{display:inline;}\n`;
  svg += `svg .flow-ide{display:none;}\nsvg.show-ide .flow-ide{display:inline;}\n`;
  svg += `svg .flow-fiscal{display:none;}\nsvg.show-fiscal .flow-fiscal{display:inline;}\n`;
  svg += `svg .flow-condicional{display:none;}\nsvg.show-condicional .flow-condicional{display:inline;}\n`;
  svg += `svg .loop-r1-el, svg .loop-r2-el, svg .loop-r3-el, svg .loop-b1-el{display:none;}\n`;
  svg += `svg.show-loop-r1 .loop-r1-el{display:inline;}\n`;
  svg += `svg.show-loop-r2 .loop-r2-el{display:inline;}\n`;
  svg += `svg.show-loop-r3 .loop-r3-el{display:inline;}\n`;
  svg += `svg.show-loop-b1 .loop-b1-el{display:inline;}\n`;

  // Extra: hide any flow/loop not explicitly allowed via root classes (also helps if flowsOn is empty).
  svg += flowHiddenCss("main");
  svg += flowHiddenCss("feedback");
  svg += flowHiddenCss("participacion");
  svg += flowHiddenCss("ide");
  svg += flowHiddenCss("fiscal");
  svg += flowHiddenCss("condicional");
  svg += loopHiddenCss("r1");
  svg += loopHiddenCss("r2");
  svg += loopHiddenCss("r3");
  svg += loopHiddenCss("b1");
  svg += `</style>\n`;

  // Background
  svg += `<rect x="0" y="0" width="3000" height="2300" fill="#ffffff"/>\n`;

  // Stage dividers
  for (const d of dividers) {
    svg += `<line class="divider" x1="20" y1="${d.top}" x2="2980" y2="${d.top}"/>\n`;
  }

  // Phases
  for (const p of phases) {
    svg += `<text class="phase" x="28" y="${p.top + 24}">${escXml(p.text)}</text>\n`;
  }

  // Links + loop halos (original SVG content)
  svg += `<g class="links">\n${linksNoDefs}\n</g>\n`;

  // Nodes
  for (const n of nodes) {
    const theme = pickNodeTheme(n.cls);
    const x = n.left;
    const y = n.top;
    const w = 300;
    const h = 106;
    const padX = 14;
    const titleY = y + 34;
    const bodyY = y + 66;
    const title = n.title.toUpperCase();
    const bodyLines = wrapWords(n.body, 36).slice(0, 2);

    svg += `<rect class="node-rect" x="${x}" y="${y}" width="${w}" height="${h}" fill="${theme.fill}" stroke="${theme.stroke}"/>\n`;
    svg += `<text class="node-title" x="${x + w / 2}" y="${titleY}" fill="${theme.ink}" text-anchor="middle">${escXml(title)}</text>\n`;
    bodyLines.forEach((line, idx) => {
      svg += `<text class="node-body" x="${x + w / 2}" y="${bodyY + idx * 22}" fill="${theme.ink}" text-anchor="middle">${escXml(line)}</text>\n`;
    });
  }

  // Results
  for (const r of results) {
    const isFiscal = r.cls.includes("result-ingresos");
    const x = r.left;
    const y = r.top;
    const w = 258;
    const h = isFiscal ? 108 : 68;
    const stroke = isFiscal ? "#ff0000" : "#0000ff";
    const ink = stroke;
    const titleLines = wrapWords(r.head, 26).slice(0, 2);
    const subLines = wrapWords(r.sub, 28).slice(0, 2);

    svg += `<rect class="result-rect" x="${x}" y="${y}" width="${w}" height="${h}" stroke="${stroke}"/>\n`;
    titleLines.forEach((line, idx) => {
      svg += `<text class="result-title" x="${x + w / 2}" y="${y + 26 + idx * 18}" fill="${ink}" text-anchor="middle">${escXml(line)}</text>\n`;
    });
    subLines.forEach((line, idx) => {
      svg += `<text class="result-sub" x="${x + w / 2}" y="${y + (isFiscal ? 72 : 52) + idx * 16}" fill="${ink}" text-anchor="middle">${escXml(line)}</text>\n`;
    });
  }

  // IDE lane
  if (ideTitle) {
    const x = 28;
    const y = 1188;
    const w = 2115;
    const h = 148;
    svg += `<rect class="ide-rect" x="${x}" y="${y}" width="${w}" height="${h}"/>\n`;
    svg += `<text class="ide-title" x="${x + w / 2}" y="${y + 70}" text-anchor="middle">${escXml(ideTitle)}</text>\n`;
    svg += `<text class="ide-sub" x="${x + w / 2}" y="${y + 112}" text-anchor="middle">${escXml(ideSub)}</text>\n`;
  }

  // Edge labels (as plain text; colored per class)
  for (const e of edgeLabels) {
    const x = e.left;
    const y = e.top + 24;
    let fill = "#0000ff";
    if (e.cls.includes("flow-participacion")) fill = "#ff0000";
    if (e.cls.includes("fiscal")) fill = "#ff0000";
    if (e.cls.includes("flow-feedback-label")) fill = "#7f7f7f";
    if (e.cls.includes("flow-condicional")) fill = e.color || "#7f7f7f";
    const cls = e.cls
      .split(/\s+/)
      .filter(Boolean)
      .filter((c) => c.startsWith("flow-") || c.endsWith("-label") || c === "fiscal")
      .join(" ");
    svg += `<text class="edge-text ${escXml(cls)}" x="${x}" y="${y}" fill="${fill}">${escXml(e.text)}</text>\n`;
  }

  // Loop chips
  for (const c of loopChips) {
    const x = c.left;
    const y = c.top;
    const w = 70;
    const h = 44;
    let fill = "rgba(0,0,255,0.14)";
    let ink = "#0000ff";
    if (c.cls.includes("loop-r2")) { fill = "rgba(40,40,255,0.14)"; ink = "#1b1bff"; }
    if (c.cls.includes("loop-r3")) { fill = "rgba(80,80,255,0.14)"; ink = "#2f2fff"; }
    if (c.cls.includes("loop-b1")) { fill = "rgba(0,0,255,0.10)"; ink = "#0000cc"; }
    const loopCls = c.cls.split(/\s+/).find((s) => s === "loop-r1-el" || s === "loop-r2-el" || s === "loop-r3-el" || s === "loop-b1-el") || "";
    svg += `<rect class="loop-chip-rect ${escXml(loopCls)}" x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>\n`;
    svg += `<text class="loop-chip-code ${escXml(loopCls)}" x="${x + w / 2}" y="${y + 20}" fill="${ink}" text-anchor="middle">${escXml(c.code)}</text>\n`;
    svg += `<text class="loop-chip-sub ${escXml(loopCls)}" x="${x + w / 2}" y="${y + 38}" fill="${ink}" text-anchor="middle">${escXml(c.sub)}</text>\n`;
  }

  svg += `</svg>\n`;
  writeFileSync(args.outPath, svg, "utf8");
}

main();

